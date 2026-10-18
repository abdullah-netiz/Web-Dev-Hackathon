import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { Prisma, type PaymentStatus } from '@prisma/client';
import { Queue } from 'bullmq';

import { AuditService } from '../audit/audit.service';
import { actorLabel, hasPermission, type AuthContext } from '../auth/auth.types';
import { DomainEvents } from '../common/domain-events';
import { ENV, type Env } from '../common/env';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';
import { cursorWhere, pageResult, type Pagination } from '../common/pagination';
import { ActivitiesService } from '../crm/activities.service';
import { ConnectionsService } from '../integrations/connections.service';
import { IntegrationEventsService } from '../integrations/integration-events.service';
import { LemonSqueezyProvider, type LemonSqueezyCredentials, type LemonSqueezyWebhook } from '../integrations/providers/lemonsqueezy.provider';
import { JOB_NAMES, QUEUES } from '../jobs/queues';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const PAYMENT_INCLUDE = {
  opportunity: { select: { id: true, name: true, stageId: true } },
  contact: { select: { id: true, firstName: true, lastName: true, email: true } },
  requestedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.PaymentInclude;

/**
 * Payments through Lemon Squeezy hosted checkout (I2). Status changes only through verified webhooks
 * (I2.2, I2.3) and each event is applied once (I2.4). Lemon Squeezy has no "checkout expired" event, so a
 * sweep marks unpaid requests EXPIRED after their deadline (I2.5). Card data never touches us (I2.8).
 */
@Injectable()
export class PaymentsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly connections: ConnectionsService,
    private readonly events: IntegrationEventsService,
    private readonly lemonSqueezy: LemonSqueezyProvider,
    private readonly realtime: RealtimeGateway,
    private readonly domainEvents: DomainEvents,
    @InjectQueue(QUEUES.payments) private readonly paymentsQueue: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap() {
    await this.paymentsQueue.upsertJobScheduler('payment-expiry-sweep', { every: 30_000 }, { name: JOB_NAMES.expirePayments, opts: { removeOnComplete: { count: 10 }, removeOnFail: { count: 10 } } });
  }

  /** I2.1: create a payment request for a stated amount; returns the hosted checkout URL to send to the customer. */
  async createRequest(auth: AuthContext, opportunityId: string, input: { amount: number; currency?: string; description?: string; expiresInMinutes?: number }) {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id: opportunityId, workspaceId: auth.workspaceId }, include: { contact: true } });
    if (!opportunity) throw new NotFoundException({ code: 'OPPORTUNITY_NOT_FOUND', message: 'Opportunity not found.' });
    const stored = await this.connections.credentials<LemonSqueezyCredentials>(auth.workspaceId, 'LEMONSQUEEZY');
    if (!stored) throw new DomainError('PAYMENTS_NOT_CONNECTED', 'Payments are not connected for this workspace.', 409, 'Connect Lemon Squeezy in Settings → Integrations.');

    // Lemon Squeezy charges in the store's currency, so the request is recorded in that currency
    const storeCurrency = String(stored.config.currency ?? 'USD').toUpperCase();
    if (input.currency && input.currency.toUpperCase() !== storeCurrency) {
      throw new DomainError('CURRENCY_MISMATCH', `Payments are collected in ${storeCurrency}, the currency of the connected store.`, 422, `Enter the amount in ${storeCurrency}.`);
    }
    const expiresAt = new Date(Date.now() + (input.expiresInMinutes ?? 60) * 60_000);

    const payment = await this.prisma.payment.create({
      data: { workspaceId: auth.workspaceId, opportunityId, contactId: opportunity.contactId, requestedById: auth.userId, amount: new Prisma.Decimal(input.amount), currency: storeCurrency, status: 'PENDING', expiresAt },
    });
    try {
      const checkout = await this.lemonSqueezy.createCheckout(stored.credentials, {
        paymentId: payment.id,
        workspaceId: auth.workspaceId,
        amount: input.amount,
        name: opportunity.name,
        description: input.description,
        customerEmail: opportunity.contact.email ?? undefined,
        customerName: `${opportunity.contact.firstName} ${opportunity.contact.lastName}`.trim(),
        redirectUrl: `${this.env.APP_URL}/pay/success?payment=${payment.id}`,
        expiresAt,
      });
      const updated = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.payment.update({ where: { id: payment.id }, data: { checkoutId: checkout.checkoutId, checkoutUrl: checkout.url, expiresAt: checkout.expiresAt ?? expiresAt }, include: PAYMENT_INCLUDE });
        await tx.opportunity.update({ where: { id: opportunityId }, data: { paymentStatus: opportunity.paymentStatus === 'PAID' ? 'PAID' : 'PENDING' } });
        await this.activities.logTx(tx, { workspaceId: auth.workspaceId, entityType: 'OPPORTUNITY', entityId: opportunityId, type: 'payment', actorId: auth.userId, payload: { paymentId: payment.id, status: 'PENDING', amount: input.amount, currency: storeCurrency } });
        await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'payment.requested', targetType: 'payment', targetId: payment.id, after: { opportunityId, amount: input.amount, currency: storeCurrency, checkoutId: checkout.checkoutId } });
        return saved;
      });
      await this.events.record({ workspaceId: auth.workspaceId, provider: 'LEMONSQUEEZY', direction: 'OUT', type: 'checkout.created', externalEventId: `out:${checkout.checkoutId}`, payload: { checkoutId: checkout.checkoutId, amount: input.amount, currency: storeCurrency }, relatedType: 'payment', relatedId: payment.id });
      await this.connections.markHealth(auth.workspaceId, 'LEMONSQUEEZY', true);
      this.domainEvents.emit('opportunity.activity', { workspaceId: auth.workspaceId, opportunityId, actorId: auth.userId, type: 'payment' });
      this.realtime.toWorkspace(auth.workspaceId, 'payment:updated', { paymentId: payment.id, opportunityId, status: 'PENDING' });
      return this.mask(auth, updated);
    } catch (error) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: (error as Error).message } });
      await this.events.record({ workspaceId: auth.workspaceId, provider: 'LEMONSQUEEZY', direction: 'OUT', type: 'checkout.failed', payload: { message: (error as Error).message }, relatedType: 'payment', relatedId: payment.id });
      await this.connections.markHealth(auth.workspaceId, 'LEMONSQUEEZY', false, (error as Error).message);
      this.realtime.toWorkspace(auth.workspaceId, 'payment:updated', { paymentId: payment.id, opportunityId, status: 'FAILED' });
      throw error;
    }
  }

  /** Applies a verified webhook. Idempotent: states only move forward and refund totals are absolute. */
  async handleEvent(workspaceId: string, raw: unknown) {
    const event = raw as LemonSqueezyWebhook;
    const attributes = event.data.attributes;
    const paymentId = event.meta.custom_data?.payment_id;
    const payment = paymentId ? await this.prisma.payment.findFirst({ where: { id: paymentId, workspaceId } }) : await this.prisma.payment.findFirst({ where: { workspaceId, providerOrderId: event.data.id } });
    if (!payment) {
      this.logger.warn(`Lemon Squeezy ${event.meta.event_name} (order ${event.data.id}) did not match a payment in workspace ${workspaceId}`);
      return undefined;
    }

    const orderStatus = String(attributes.status ?? '');
    const refundedCents = Number(attributes.refunded_amount ?? 0);
    let status: PaymentStatus = payment.status;
    const data: Prisma.PaymentUpdateInput = { providerOrderId: event.data.id };

    switch (event.meta.event_name) {
      case 'order_created':
      case 'order_updated':
        if (orderStatus === 'paid' && (payment.status === 'PENDING' || payment.status === 'EXPIRED' || payment.status === 'FAILED')) {
          // A customer who pays just after our expiry sweep still counts as paid: the provider is authoritative
          status = 'PAID';
          data.paidAt = payment.paidAt ?? new Date(String(attributes.created_at ?? new Date().toISOString()));
        } else if (orderStatus === 'failed' && payment.status === 'PENDING') {
          status = 'FAILED';
          data.failureReason = 'The payment failed at the provider.';
        }
        break;
      case 'order_refunded': {
        const refunded = refundedCents / 100;
        data.refundedAmount = new Prisma.Decimal(Math.max(refunded, Number(payment.refundedAmount)));
        status = orderStatus === 'refunded' || refunded >= Number(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
        data.paidAt = payment.paidAt ?? new Date();
        break;
      }
      default:
        return { relatedType: 'payment', relatedId: payment.id };
    }

    const statusChanged = status !== payment.status;
    const refundChanged = data.refundedAmount !== undefined && Number(data.refundedAmount) !== Number(payment.refundedAmount);
    if (!statusChanged && !refundChanged && payment.providerOrderId === event.data.id) return { relatedType: 'payment', relatedId: payment.id };

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { ...data, status } });
      await tx.opportunity.update({ where: { id: payment.opportunityId }, data: { paymentStatus: await this.opportunityPaymentState(tx, payment.opportunityId) } });
      if (statusChanged || refundChanged) {
        await this.activities.logTx(tx, { workspaceId, entityType: 'OPPORTUNITY', entityId: payment.opportunityId, type: 'payment', actorId: null, payload: { paymentId: payment.id, status, event: event.meta.event_name, amount: Number(payment.amount), currency: payment.currency, orderId: event.data.id } });
        await this.audit.recordTx(tx, { workspaceId, actorId: null, actorLabel: 'lemon squeezy webhook', action: `payment.${status.toLowerCase()}`, targetType: 'payment', targetId: payment.id, before: { status: payment.status, refundedAmount: Number(payment.refundedAmount) }, after: { status, event: event.meta.event_name, orderId: event.data.id, refundedAmount: data.refundedAmount !== undefined ? Number(data.refundedAmount) : undefined } });
      }
    });
    await this.connections.markHealth(workspaceId, 'LEMONSQUEEZY', true);
    this.realtime.toWorkspace(workspaceId, 'payment:updated', { paymentId: payment.id, opportunityId: payment.opportunityId, status, event: event.meta.event_name });
    if (payment.requestedById && statusChanged) this.realtime.toUser(payment.requestedById, 'notification', { title: `Payment ${status.toLowerCase().replace('_', ' ')}`, body: `${payment.currency} ${Number(payment.amount).toFixed(2)}`, link: `/opportunities/${payment.opportunityId}` });
    return { relatedType: 'payment', relatedId: payment.id };
  }

  /** I2.5: unpaid requests past their deadline become EXPIRED (runs every 30 s). */
  async expireOverdue() {
    const overdue = await this.prisma.payment.findMany({ where: { status: 'PENDING', expiresAt: { lt: new Date() } }, select: { id: true, workspaceId: true, opportunityId: true } });
    for (const payment of overdue) {
      const updated = await this.prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      if (updated.count === 0) continue;
      await this.prisma.$transaction(async (tx) => {
        await tx.opportunity.update({ where: { id: payment.opportunityId }, data: { paymentStatus: await this.opportunityPaymentState(tx, payment.opportunityId) } });
        await this.activities.logTx(tx, { workspaceId: payment.workspaceId, entityType: 'OPPORTUNITY', entityId: payment.opportunityId, type: 'payment', actorId: null, payload: { paymentId: payment.id, status: 'EXPIRED', reason: 'payment link expired unpaid' } });
      });
      this.realtime.toWorkspace(payment.workspaceId, 'payment:updated', { paymentId: payment.id, opportunityId: payment.opportunityId, status: 'EXPIRED' });
    }
    return { expired: overdue.length };
  }

  async list(auth: AuthContext, query: Pagination & { status?: PaymentStatus; from?: string; to?: string; opportunityId?: string }) {
    const where: Prisma.PaymentWhereInput = {
      workspaceId: auth.workspaceId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      ...(query.from || query.to ? { paidAt: { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } } : {}),
      ...(hasPermission(auth, 'leads.view_all') ? {} : { requestedById: auth.userId }),
      ...cursorWhere(query.cursor),
    };
    const rows = await this.prisma.payment.findMany({ where, include: PAYMENT_INCLUDE, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1 });
    const page = pageResult(rows, query.limit);
    return { ...page, data: page.data.map((row) => this.mask(auth, row)) };
  }

  async get(auth: AuthContext, id: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id, workspaceId: auth.workspaceId }, include: PAYMENT_INCLUDE });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment not found.' });
    return this.mask(auth, payment);
  }

  /** I2.7 traceability is kept; amounts follow the value permission (F1.4). */
  private mask<T extends { amount: Prisma.Decimal; refundedAmount: Prisma.Decimal }>(auth: AuthContext, payment: T) {
    const canSee = hasPermission(auth, 'crm.view_values');
    return { ...payment, amount: canSee ? Number(payment.amount) : null, refundedAmount: canSee ? Number(payment.refundedAmount) : null, valueHidden: !canSee };
  }

  private async opportunityPaymentState(tx: Prisma.TransactionClient, opportunityId: string) {
    const payments = await tx.payment.findMany({ where: { opportunityId }, select: { status: true } });
    const statuses = new Set(payments.map((payment) => payment.status));
    if (statuses.has('PAID')) return 'PAID' as const;
    if (statuses.has('PARTIALLY_REFUNDED')) return 'PARTIALLY_REFUNDED' as const;
    if (statuses.has('REFUNDED')) return 'REFUNDED' as const;
    if (statuses.has('PENDING')) return 'PENDING' as const;
    if (statuses.has('FAILED')) return 'FAILED' as const;
    if (statuses.has('EXPIRED')) return 'EXPIRED' as const;
    return 'NONE' as const;
  }
}
