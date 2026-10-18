import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type PaymentStatus } from '@prisma/client';
import type Stripe from 'stripe';

import { AuditService } from '../audit/audit.service';
import { actorLabel, hasPermission, type AuthContext } from '../auth/auth.types';
import { DomainEvents } from '../common/domain-events';
import { ENV, type Env } from '../common/env';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';
import { cursorWhere, pageResult, type Pagination } from '../common/pagination';
import { ActivitiesService } from '../crm/activities.service';
import { ConnectionsService, type StripeCredentials } from '../integrations/connections.service';
import { IntegrationEventsService } from '../integrations/integration-events.service';
import { StripeProvider } from '../integrations/providers/stripe.provider';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const PAYMENT_INCLUDE = {
  opportunity: { select: { id: true, name: true, stageId: true } },
  contact: { select: { id: true, firstName: true, lastName: true, email: true } },
  requestedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.PaymentInclude;

/**
 * Payments through Stripe Checkout (I2). Status is driven only by verified webhooks (I2.2); each event is
 * applied once (I2.4); card data never touches us (I2.8). Collected vs projected follows Section 7.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly connections: ConnectionsService,
    private readonly events: IntegrationEventsService,
    private readonly stripe: StripeProvider,
    private readonly realtime: RealtimeGateway,
    private readonly domainEvents: DomainEvents,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** I2.1: create a payment request for a stated amount and currency; returns the hosted checkout URL. */
  async createRequest(auth: AuthContext, opportunityId: string, input: { amount: number; currency?: string; description?: string; expiresInMinutes?: number }) {
    const opportunity = await this.prisma.opportunity.findFirst({ where: { id: opportunityId, workspaceId: auth.workspaceId }, include: { contact: true } });
    if (!opportunity) throw new NotFoundException({ code: 'OPPORTUNITY_NOT_FOUND', message: 'Opportunity not found.' });
    const stored = await this.connections.credentials<StripeCredentials>(auth.workspaceId, 'STRIPE');
    if (!stored) throw new DomainError('STRIPE_NOT_CONNECTED', 'Payments are not connected for this workspace.', 409, 'Connect Stripe in Settings → Integrations.');
    const currency = (input.currency ?? opportunity.currency).toUpperCase();

    // Create the record first so the Stripe idempotency key is stable across retries
    const payment = await this.prisma.payment.create({
      data: { workspaceId: auth.workspaceId, opportunityId, contactId: opportunity.contactId, requestedById: auth.userId, amount: new Prisma.Decimal(input.amount), currency, status: 'PENDING' },
    });
    try {
      const checkout = await this.stripe.createCheckout(stored.credentials, {
        paymentId: payment.id,
        amount: input.amount,
        currency,
        description: input.description ?? `${opportunity.name} — ${opportunity.contact.firstName} ${opportunity.contact.lastName}`.trim(),
        customerEmail: opportunity.contact.email ?? undefined,
        successUrl: `${this.env.APP_URL}/pay/success?payment=${payment.id}`,
        cancelUrl: `${this.env.APP_URL}/pay/cancelled?payment=${payment.id}`,
        metadata: { paymentId: payment.id, workspaceId: auth.workspaceId, opportunityId },
        expiresInMinutes: input.expiresInMinutes,
      });
      const updated = await this.prisma.$transaction(async (tx) => {
        const saved = await tx.payment.update({
          where: { id: payment.id },
          data: { stripeSessionId: checkout.sessionId, stripePaymentIntentId: checkout.paymentIntentId, checkoutUrl: checkout.url, expiresAt: checkout.expiresAt },
          include: PAYMENT_INCLUDE,
        });
        await tx.opportunity.update({ where: { id: opportunityId }, data: { paymentStatus: opportunity.paymentStatus === 'PAID' ? 'PAID' : 'PENDING' } });
        await this.activities.logTx(tx, { workspaceId: auth.workspaceId, entityType: 'OPPORTUNITY', entityId: opportunityId, type: 'payment', actorId: auth.userId, payload: { paymentId: payment.id, status: 'PENDING', amount: input.amount, currency } });
        await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'payment.requested', targetType: 'payment', targetId: payment.id, after: { opportunityId, amount: input.amount, currency, stripeSessionId: checkout.sessionId } });
        return saved;
      });
      await this.events.record({ workspaceId: auth.workspaceId, provider: 'STRIPE', direction: 'OUT', type: 'checkout.session.created', externalEventId: `out:${checkout.sessionId}`, payload: { sessionId: checkout.sessionId, amount: input.amount, currency }, relatedType: 'payment', relatedId: payment.id });
      await this.connections.markHealth(auth.workspaceId, 'STRIPE', true);
      this.domainEvents.emit('opportunity.activity', { workspaceId: auth.workspaceId, opportunityId, actorId: auth.userId, type: 'payment' });
      this.realtime.toWorkspace(auth.workspaceId, 'payment:updated', { paymentId: payment.id, opportunityId, status: 'PENDING' });
      return this.mask(auth, updated);
    } catch (error) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: (error as Error).message } });
      await this.events.record({ workspaceId: auth.workspaceId, provider: 'STRIPE', direction: 'OUT', type: 'checkout.session.failed', payload: { message: (error as Error).message }, relatedType: 'payment', relatedId: payment.id });
      await this.connections.markHealth(auth.workspaceId, 'STRIPE', false, (error as Error).message);
      throw error;
    }
  }

  /** Applies a verified Stripe event. Idempotent: transitions only move forward and refunds are absolute. */
  async handleEvent(workspaceId: string, raw: unknown) {
    const event = raw as Stripe.Event;
    const object = event.data.object as Stripe.Checkout.Session | Stripe.PaymentIntent | Stripe.Charge | Stripe.Refund;
    const payment = await this.locatePayment(workspaceId, event, object);
    if (!payment) {
      this.logger.warn(`Stripe event ${event.type} (${event.id}) did not match a payment in workspace ${workspaceId}`);
      return undefined;
    }

    let status: PaymentStatus = payment.status;
    const data: Prisma.PaymentUpdateInput = {};
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = object as Stripe.Checkout.Session;
        if (session.payment_status === 'paid') {
          status = payment.status === 'REFUNDED' || payment.status === 'PARTIALLY_REFUNDED' ? payment.status : 'PAID';
          data.paidAt = payment.paidAt ?? new Date(event.created * 1000);
          data.stripePaymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : payment.stripePaymentIntentId;
        }
        break;
      }
      case 'checkout.session.expired':
        if (payment.status === 'PENDING') status = 'EXPIRED';
        break;
      case 'checkout.session.async_payment_failed':
      case 'payment_intent.payment_failed': {
        if (payment.status === 'PENDING') status = 'FAILED';
        const intent = object as Stripe.PaymentIntent;
        data.failureReason = intent.last_payment_error?.message ?? 'Payment failed at the provider.';
        break;
      }
      case 'charge.refunded': {
        const charge = object as Stripe.Charge;
        const refunded = charge.amount_refunded / 100;
        data.refundedAmount = new Prisma.Decimal(refunded);
        status = refunded >= Number(payment.amount) ? 'REFUNDED' : refunded > 0 ? 'PARTIALLY_REFUNDED' : status;
        break;
      }
      case 'refund.created':
      case 'refund.updated': {
        const refund = object as Stripe.Refund;
        if (refund.status === 'succeeded') {
          const refunded = Math.max(Number(payment.refundedAmount), refund.amount / 100);
          data.refundedAmount = new Prisma.Decimal(refunded);
          status = refunded >= Number(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
        }
        break;
      }
      default:
        return { relatedType: 'payment', relatedId: payment.id };
    }

    const changed = status !== payment.status || Object.keys(data).length > 0;
    if (!changed) return { relatedType: 'payment', relatedId: payment.id };

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { ...data, status } });
      const opportunityStatus = await this.opportunityPaymentState(tx, payment.opportunityId);
      await tx.opportunity.update({ where: { id: payment.opportunityId }, data: { paymentStatus: opportunityStatus } });
      await this.activities.logTx(tx, { workspaceId, entityType: 'OPPORTUNITY', entityId: payment.opportunityId, type: 'payment', actorId: null, payload: { paymentId: payment.id, status, event: event.type, amount: Number(payment.amount), currency: payment.currency } });
      await this.audit.recordTx(tx, { workspaceId, actorId: null, actorLabel: 'stripe webhook', action: `payment.${status.toLowerCase()}`, targetType: 'payment', targetId: payment.id, before: { status: payment.status }, after: { status, event: event.type, eventId: event.id } });
    });
    await this.connections.markHealth(workspaceId, 'STRIPE', true);
    this.realtime.toWorkspace(workspaceId, 'payment:updated', { paymentId: payment.id, opportunityId: payment.opportunityId, status, event: event.type });
    if (payment.requestedById) this.realtime.toUser(payment.requestedById, 'notification', { title: `Payment ${status.toLowerCase().replace('_', ' ')}`, body: `${payment.currency} ${Number(payment.amount).toFixed(2)}`, link: `/opportunities/${payment.opportunityId}` });
    return { relatedType: 'payment', relatedId: payment.id };
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

  private async locatePayment(workspaceId: string, event: Stripe.Event, object: { id: string; metadata?: Stripe.Metadata | null }) {
    const metadataId = object.metadata?.paymentId;
    if (metadataId) {
      const byMeta = await this.prisma.payment.findFirst({ where: { id: metadataId, workspaceId } });
      if (byMeta) return byMeta;
    }
    if (event.type.startsWith('checkout.session')) {
      return this.prisma.payment.findFirst({ where: { stripeSessionId: object.id, workspaceId } });
    }
    const intentId = 'payment_intent' in object ? ((object as Stripe.Charge).payment_intent as string | null) : event.type.startsWith('payment_intent') ? object.id : null;
    if (intentId) return this.prisma.payment.findFirst({ where: { stripePaymentIntentId: intentId, workspaceId } });
    return null;
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
