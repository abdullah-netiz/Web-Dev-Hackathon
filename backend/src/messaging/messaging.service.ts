import { InjectQueue } from '@nestjs/bullmq';
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type MessageStatus } from '@prisma/client';
import { Queue } from 'bullmq';

import { actorLabel, hasPermission, type AuthContext } from '../auth/auth.types';
import { ENV, type Env } from '../common/env';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';
import { cursorWhere, pageResult, type Pagination, skipFor } from '../common/pagination';
import { ActivitiesService } from '../crm/activities.service';
import { RecordsService } from '../crm/records.service';
import { ConnectionsService, type TwilioCredentials } from '../integrations/connections.service';
import { IntegrationEventsService } from '../integrations/integration-events.service';
import { ProviderError, TwilioProvider } from '../integrations/providers/twilio.provider';
import { JOB_NAMES, QUEUES } from '../jobs/queues';
import { isWithinCustomerServiceWindow, nextMessageStatus } from '../leads/assignment.logic';
import { LeadsService } from '../leads/leads.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const TWILIO_STATUS_MAP: Record<string, MessageStatus> = { queued: 'QUEUED', accepted: 'QUEUED', sending: 'QUEUED', sent: 'SENT', delivered: 'DELIVERED', read: 'READ', undelivered: 'UNDELIVERED', failed: 'FAILED' };
const OPT_OUT = /^\s*(stop|unsubscribe|cancel|end|quit)\s*$/i;

/** WhatsApp conversations via Twilio (I1). The provider sits behind an interface; this service owns the rules. */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly leads: LeadsService,
    private readonly activities: ActivitiesService,
    private readonly connections: ConnectionsService,
    private readonly events: IntegrationEventsService,
    private readonly twilio: TwilioProvider,
    private readonly realtime: RealtimeGateway,
    @InjectQueue(QUEUES.integrations) private readonly outbound: Queue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────── Inbound (I1.1, I1.5, I1.9, F3.1) ─────────────

  async handleInbound(workspaceId: string, params: Record<string, string>) {
    const from = params.From ?? ''; // whatsapp:+E164
    const channel = from.startsWith('whatsapp:') ? 'WHATSAPP' : 'SMS';
    const body = params.Body ?? '';
    const existing = await this.prisma.message.findUnique({ where: { providerSid: params.MessageSid } });
    if (existing) return { relatedType: 'message', relatedId: existing.id };

    const { contact, created } = await this.records.findOrCreateByPhone(workspaceId, from, params.ProfileName);
    const conversation = await this.prisma.conversation.upsert({
      where: { workspaceId_channel_externalAddress: { workspaceId, channel, externalAddress: from } },
      create: { workspaceId, contactId: contact.id, channel, externalAddress: from, assigneeId: contact.ownerId, lastInboundAt: new Date(), lastMessageAt: new Date(), unreadCount: 1 },
      update: { lastInboundAt: new Date(), lastMessageAt: new Date(), unreadCount: { increment: 1 } },
    });

    // Opt-out is ours to handle: Twilio's STOP keywords do not apply to WhatsApp (I1.9)
    if (OPT_OUT.test(body)) {
      await this.prisma.contact.update({ where: { id: contact.id }, data: { optedOut: true } });
      await this.activities.log({ workspaceId, entityType: 'CONTACT', entityId: contact.id, type: 'opt_out', actorId: null, payload: { via: 'whatsapp keyword' } });
    }

    // A new message from a contact with an open lead touches that lead instead of creating a second one
    const openLead = await this.prisma.lead.findFirst({ where: { workspaceId, contactId: contact.id, status: { in: ['NEW', 'ASSIGNED', 'ACKNOWLEDGED'] } }, orderBy: { createdAt: 'desc' } });
    const message = await this.prisma.message.create({
      data: { workspaceId, conversationId: conversation.id, contactId: contact.id, leadId: openLead?.id ?? null, direction: 'INBOUND', body, providerSid: params.MessageSid, status: 'DELIVERED', deliveredAt: new Date() },
    });

    let leadId = openLead?.id ?? null;
    let assigneeId = conversation.assigneeId;
    if (!openLead) {
      const lead = await this.leads.captureLead(workspaceId, { source: 'MESSAGE', title: body.length > 60 ? `${body.slice(0, 57)}…` : body || 'WhatsApp message', notes: body, contactId: contact.id });
      leadId = lead.id;
      assigneeId = assigneeId ?? lead.currentAssigneeId;
      await this.prisma.message.update({ where: { id: message.id }, data: { leadId } });
      if (!conversation.assigneeId && lead.currentAssigneeId) await this.prisma.conversation.update({ where: { id: conversation.id }, data: { assigneeId: lead.currentAssigneeId } });
    } else {
      await this.prisma.lead.update({ where: { id: openLead.id }, data: { lastActivityAt: new Date() } });
      assigneeId = assigneeId ?? openLead.currentAssigneeId;
    }
    await this.activities.log({ workspaceId, entityType: leadId ? 'LEAD' : 'CONTACT', entityId: leadId ?? contact.id, type: 'message', actorId: null, payload: { direction: 'INBOUND', messageId: message.id, preview: body.slice(0, 120) } });
    await this.connections.markHealth(workspaceId, 'TWILIO', true);

    this.realtime.toWorkspace(workspaceId, 'message:new', { messageId: message.id, conversationId: conversation.id, contactId: contact.id, leadId, assigneeId, direction: 'INBOUND', preview: body.slice(0, 120), newContact: created });
    if (assigneeId) this.realtime.toUser(assigneeId, 'notification', { title: `New WhatsApp message from ${contact.firstName}`, body: body.slice(0, 120), link: `/conversations/${conversation.id}` });
    return { relatedType: 'message', relatedId: message.id };
  }

  /** Status callbacks arrive out of order and may repeat; transitions are monotonic (I1.4). */
  async handleStatus(workspaceId: string, params: Record<string, string>) {
    const message = await this.prisma.message.findUnique({ where: { providerSid: params.MessageSid } });
    if (!message || message.workspaceId !== workspaceId) return undefined;
    const incoming = TWILIO_STATUS_MAP[params.MessageStatus] ?? message.status;
    const next = nextMessageStatus(message.status, incoming) as MessageStatus;
    if (next === message.status && !params.ErrorCode) return { relatedType: 'message', relatedId: message.id };
    const failed = next === 'FAILED' || next === 'UNDELIVERED';
    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        status: next,
        deliveredAt: next === 'DELIVERED' || next === 'READ' ? message.deliveredAt ?? new Date() : message.deliveredAt,
        errorCode: params.ErrorCode ?? message.errorCode,
        errorMessage: failed ? explainStatusError(params.ErrorCode) : message.errorMessage,
      },
    });
    if (failed) await this.connections.markHealth(workspaceId, 'TWILIO', false, `Message ${params.MessageSid} ${params.MessageStatus}${params.ErrorCode ? ` (code ${params.ErrorCode})` : ''}`);
    this.realtime.toWorkspace(workspaceId, 'message:status', { messageId: message.id, conversationId: message.conversationId, status: next, errorCode: params.ErrorCode ?? null, errorMessage: failed ? explainStatusError(params.ErrorCode) : null });
    return { relatedType: 'message', relatedId: message.id };
  }

  // ───────────── Outbound (I1.3, I1.7) ─────────────

  async send(auth: AuthContext, conversationId: string, body: string) {
    const conversation = await this.getConversation(auth, conversationId);
    const contact = await this.prisma.contact.findUniqueOrThrow({ where: { id: conversation.contactId } });
    if (contact.optedOut) {
      throw new DomainError('CONTACT_OPTED_OUT', `${contact.firstName} opted out of messages and cannot be contacted on this channel.`, 409, 'Remove the opt-out on the contact only if they asked to be contacted again.');
    }
    const credentials = await this.connections.credentials<TwilioCredentials>(auth.workspaceId, 'TWILIO');
    if (!credentials) throw new DomainError('TWILIO_NOT_CONNECTED', 'WhatsApp messaging is not connected for this workspace.', 409, 'Connect Twilio in Settings → Integrations.');
    if (!isWithinCustomerServiceWindow(conversation.lastInboundAt, new Date())) {
      throw new DomainError('OUTSIDE_24H_WINDOW', "WhatsApp only allows free-form replies within 24 hours of the customer's last message.", 409, 'Wait for the customer to write again, or contact them on another channel.');
    }
    const lead = await this.prisma.lead.findFirst({ where: { workspaceId: auth.workspaceId, contactId: contact.id, status: { in: ['ASSIGNED', 'ACKNOWLEDGED'] } }, orderBy: { createdAt: 'desc' } });
    const message = await this.prisma.message.create({
      data: { workspaceId: auth.workspaceId, conversationId, contactId: contact.id, leadId: lead?.id ?? null, direction: 'OUTBOUND', body, status: 'QUEUED', sentById: auth.userId },
    });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), unreadCount: 0, assigneeId: conversation.assigneeId ?? auth.userId } });
    await this.activities.log({ workspaceId: auth.workspaceId, entityType: lead ? 'LEAD' : 'CONTACT', entityId: lead?.id ?? contact.id, type: 'message', actorId: auth.userId, payload: { direction: 'OUTBOUND', messageId: message.id, preview: body.slice(0, 120) } });
    if (lead) this.activities.notifyLeadActivity(auth.workspaceId, lead.id, auth.userId, 'message'); // acknowledged by action (Section 7)
    await this.outbound.add(JOB_NAMES.sendMessage, { workspaceId: auth.workspaceId, messageId: message.id }, { jobId: `send-${message.id}`, attempts: 4 });
    this.realtime.toWorkspace(auth.workspaceId, 'message:new', { messageId: message.id, conversationId, contactId: contact.id, leadId: lead?.id ?? null, direction: 'OUTBOUND', preview: body.slice(0, 120) });
    return this.prisma.message.findUniqueOrThrow({ where: { id: message.id } });
  }

  /** Start a conversation from a contact page when none exists yet. */
  async sendToContact(auth: AuthContext, contactId: string, body: string) {
    const contact = await this.records.getContact(auth, contactId);
    if (!contact.phone) throw new DomainError('NO_PHONE', 'This contact has no phone number.', 422, 'Add a phone number in international format first.');
    const externalAddress = `whatsapp:${contact.phone}`;
    const conversation = await this.prisma.conversation.upsert({
      where: { workspaceId_channel_externalAddress: { workspaceId: auth.workspaceId, channel: 'WHATSAPP', externalAddress } },
      create: { workspaceId: auth.workspaceId, contactId, channel: 'WHATSAPP', externalAddress, assigneeId: auth.userId },
      update: {},
    });
    return this.send(auth, conversation.id, body);
  }

  /** Job handler: the provider call, with retries; a final failure is recorded on the message in plain language. */
  async deliver(workspaceId: string, messageId: string, attempt: number, isLastAttempt: boolean) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId }, include: { conversation: true } });
    if (!message || message.status !== 'QUEUED' || message.providerSid) return; // already sent or cancelled: idempotent
    const stored = await this.connections.credentials<TwilioCredentials>(workspaceId, 'TWILIO');
    if (!stored) throw new ProviderError('TWILIO', 'NOT_CONNECTED', 'Twilio is not connected.', false);
    const statusCallbackUrl = `${this.env.PUBLIC_URL}/webhooks/twilio/${workspaceId}/status`;
    try {
      const result = await this.twilio.send(stored.credentials, { to: message.conversation.externalAddress, body: message.body, statusCallbackUrl });
      const status = TWILIO_STATUS_MAP[result.status] ?? 'SENT';
      await this.prisma.message.update({ where: { id: messageId }, data: { providerSid: result.sid, status, errorCode: null, errorMessage: null } });
      await this.events.record({ workspaceId, provider: 'TWILIO', direction: 'OUT', type: 'message.sent', externalEventId: `out:${result.sid}`, payload: { to: message.conversation.externalAddress, sid: result.sid }, relatedType: 'message', relatedId: messageId });
      await this.connections.markHealth(workspaceId, 'TWILIO', true);
      this.realtime.toWorkspace(workspaceId, 'message:status', { messageId, conversationId: message.conversationId, status });
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : new ProviderError('TWILIO', 'UNKNOWN', (error as Error).message, true);
      if (!providerError.retryable || isLastAttempt) {
        await this.prisma.message.update({ where: { id: messageId }, data: { status: 'FAILED', errorCode: providerError.providerCode, errorMessage: providerError.message } });
        await this.events.record({ workspaceId, provider: 'TWILIO', direction: 'OUT', type: 'message.failed', payload: { code: providerError.providerCode, message: providerError.message, attempt }, relatedType: 'message', relatedId: messageId });
        await this.connections.markHealth(workspaceId, 'TWILIO', false, providerError.message);
        this.realtime.toWorkspace(workspaceId, 'message:status', { messageId, conversationId: message.conversationId, status: 'FAILED', errorCode: providerError.providerCode, errorMessage: providerError.message });
        if (!providerError.retryable) return; // permanent error: stop retrying (I5.5)
      }
      throw providerError;
    }
  }

  /** I1.7: the employee can retry a failed message explicitly. */
  async retry(auth: AuthContext, messageId: string) {
    const message = await this.prisma.message.findFirst({ where: { id: messageId, workspaceId: auth.workspaceId } });
    if (!message) throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found.' });
    if (message.status !== 'FAILED' && message.status !== 'UNDELIVERED') throw new DomainError('NOT_FAILED', 'Only failed messages can be retried.', 409);
    await this.prisma.message.update({ where: { id: messageId }, data: { status: 'QUEUED', providerSid: null, errorCode: null, errorMessage: null } });
    await this.outbound.add(JOB_NAMES.sendMessage, { workspaceId: auth.workspaceId, messageId }, { jobId: `send-${messageId}-retry-${Date.now()}`, attempts: 4 });
    return this.prisma.message.findUniqueOrThrow({ where: { id: messageId } });
  }

  // ───────────── Queries (I1.6: visibility follows permissions) ─────────────

  async listConversations(auth: AuthContext, pagination: Pagination) {
    const where: Prisma.ConversationWhereInput = {
      workspaceId: auth.workspaceId,
      ...(hasPermission(auth, 'leads.view_all') ? {} : { OR: [{ assigneeId: auth.userId }, { contact: { ownerId: auth.userId } }] }),
      ...cursorWhere(pagination.cursor),
    };
    const rows = await this.prisma.conversation.findMany({
      where,
      include: { contact: { select: { id: true, firstName: true, lastName: true, phone: true, optedOut: true } }, assignee: { select: { id: true, firstName: true, lastName: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: skipFor(pagination), take: pagination.limit + 1,
    });
    const now = new Date();
    return pageResult(
      rows.map(({ messages, ...row }) => ({ ...row, lastMessage: messages[0] ?? null, canReply: isWithinCustomerServiceWindow(row.lastInboundAt, now) && !row.contact.optedOut })),
      pagination.limit,
    );
  }

  async getConversation(auth: AuthContext, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, workspaceId: auth.workspaceId },
      include: { contact: { select: { id: true, firstName: true, lastName: true, phone: true, optedOut: true, ownerId: true } }, assignee: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!conversation) throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found.' });
    if (!hasPermission(auth, 'leads.view_all') && conversation.assigneeId !== auth.userId && conversation.contact.ownerId !== auth.userId) {
      throw new ForbiddenException({ code: 'NOT_YOUR_CONVERSATION', message: 'This conversation is assigned to another employee.' });
    }
    const inWindow = isWithinCustomerServiceWindow(conversation.lastInboundAt, new Date());
    return {
      ...conversation,
      canReply: inWindow && !conversation.contact.optedOut,
      replyBlockedReason: conversation.contact.optedOut ? 'The contact opted out of messages.' : !inWindow ? "Outside the 24-hour WhatsApp reply window; wait for the customer's next message." : null,
    };
  }

  async listMessages(auth: AuthContext, conversationId: string, pagination: Pagination) {
    await this.getConversation(auth, conversationId);
    const rows = await this.prisma.message.findMany({
      where: { conversationId, ...cursorWhere(pagination.cursor) },
      include: { sentBy: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: skipFor(pagination), take: pagination.limit + 1,
    });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });
    return pageResult(rows, pagination.limit);
  }

  async assignConversation(auth: AuthContext, conversationId: string, userId: string) {
    const conversation = await this.getConversation(auth, conversationId);
    const user = await this.prisma.user.findFirst({ where: { id: userId, workspaceId: auth.workspaceId, isActive: true } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    const updated = await this.prisma.conversation.update({ where: { id: conversationId }, data: { assigneeId: userId } });
    await this.activities.log({ workspaceId: auth.workspaceId, entityType: 'CONTACT', entityId: conversation.contactId, type: 'conversation_assigned', actorId: auth.userId, payload: { conversationId, toUserId: userId, by: actorLabel(auth) } });
    return updated;
  }
}

function explainStatusError(code?: string): string {
  switch (code) {
    case '63016':
      return 'Outside the 24-hour WhatsApp window: only approved templates can be sent now.';
    case '63015':
      return "The customer's phone has not joined the sandbox (or the join expired).";
    case '63024':
      return 'The recipient is not a valid WhatsApp user.';
    case '30003':
      return 'The handset is unreachable or switched off.';
    default:
      return code ? `Delivery failed (Twilio error ${code}).` : 'Delivery failed.';
  }
}
