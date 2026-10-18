import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { actorLabel, hasPermission, type AuthContext } from '../auth/auth.types';
import { DomainEvents } from '../common/domain-events';
import { decrypt, encrypt, hmacSha256Hex, safeEqual } from '../common/encryption';
import { ENV, type Env } from '../common/env';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';
import { cursorWhere, pageResult, type Pagination, skipFor } from '../common/pagination';
import { ActivitiesService } from '../crm/activities.service';
import { ConnectionsService } from '../integrations/connections.service';
import { IntegrationEventsService } from '../integrations/integration-events.service';
import { GoogleCalendarProvider, GoogleReconnectRequired, type BusyInterval } from '../integrations/providers/google-calendar.provider';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const APPOINTMENT_INCLUDE = {
  contact: { select: { id: true, firstName: true, lastName: true, email: true } },
  opportunity: { select: { id: true, name: true } },
  user: { select: { id: true, firstName: true, lastName: true, timeZone: true } },
} satisfies Prisma.AppointmentInclude;

/**
 * Appointments on employees' real Google Calendars (I3). Each employee connects their own account (I3.1);
 * refresh tokens are encrypted server-side and refreshed automatically (I3.2); busy times prevent overlaps
 * (I3.4); times are stored in UTC with the booking time zone (I3.5).
 */
@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly connections: ConnectionsService,
    private readonly events: IntegrationEventsService,
    private readonly google: GoogleCalendarProvider,
    private readonly realtime: RealtimeGateway,
    private readonly domainEvents: DomainEvents,
    private readonly authService: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────── Connection (I3.1, I3.2, I3.7) ─────────────

  /** OAuth state is a signed, expiring token so the callback cannot be replayed or redirected to another user. */
  connectUrl(auth: AuthContext) {
    const exp = Date.now() + 10 * 60_000;
    const payload = `${auth.userId}.${auth.workspaceId}.${exp}`;
    const state = `${payload}.${hmacSha256Hex(this.env.APP_ENCRYPTION_KEY, `oauth:${payload}`)}`;
    return { url: this.google.authUrl(state), expiresInSec: 600 };
  }

  async handleCallback(code: string | undefined, state: string | undefined, error?: string): Promise<{ redirect: string }> {
    // The frontend result page explains the outcome to the employee (I3.1)
    const page = `${this.env.APP_URL}/connect/google`;
    const fail = (reason: string) => ({ redirect: `${page}?status=failed&reason=${encodeURIComponent(reason)}` });
    if (error || !code || !state) return fail(error === 'access_denied' ? "You declined access on Google's consent screen." : 'Google did not complete the sign-in.');
    const parts = state.split('.');
    if (parts.length !== 4) return fail('The sign-in link was invalid. Start again from your profile.');
    const [userId, workspaceId, exp, signature] = parts;
    const expected = hmacSha256Hex(this.env.APP_ENCRYPTION_KEY, `oauth:${userId}.${workspaceId}.${exp}`);
    if (!safeEqual(expected, signature) || Number(exp) < Date.now()) return fail('The sign-in link expired. Start again from your profile.');

    try {
      const { refreshToken, email } = await this.google.exchangeCode(code);
      await this.prisma.$transaction(async (tx) => {
        await tx.calendarToken.upsert({
          where: { userId },
          create: { workspaceId, userId, email, refreshTokenEnc: encrypt(refreshToken, this.env.APP_ENCRYPTION_KEY), status: 'CONNECTED' },
          update: { email, refreshTokenEnc: encrypt(refreshToken, this.env.APP_ENCRYPTION_KEY), status: 'CONNECTED', lastError: null },
        });
        await tx.integrationConnection.upsert({ where: { workspaceId_provider: { workspaceId, provider: 'GOOGLE' } }, create: { workspaceId, provider: 'GOOGLE', status: 'CONNECTED', lastOkAt: new Date() }, update: { status: 'CONNECTED', lastOkAt: new Date(), lastError: null } });
        await this.audit.recordTx(tx, { workspaceId, actorId: userId, actorLabel: email ?? userId, action: 'integration.connected', targetType: 'calendarToken', targetId: userId, after: { provider: 'GOOGLE', email } });
      });
      await this.events.record({ workspaceId, provider: 'GOOGLE', direction: 'OUT', type: 'oauth.connected', payload: { userId, email } });
      this.realtime.toWorkspace(workspaceId, 'integration:status', { provider: 'GOOGLE', status: 'CONNECTED', userId });
      return { redirect: `${page}?status=connected` };
    } catch (err) {
      this.logger.warn(`Google OAuth exchange failed: ${(err as Error).message}`);
      await this.events.record({ workspaceId, provider: 'GOOGLE', direction: 'OUT', type: 'oauth.failed', payload: { userId, message: (err as Error).message } });
      return fail((err as Error).message.slice(0, 200));
    }
  }

  async disconnect(auth: AuthContext, targetUserId?: string) {
    const userId = targetUserId ?? auth.userId;
    if (userId !== auth.userId && !hasPermission(auth, 'integrations.manage')) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'You can only disconnect your own calendar.' });
    const token = await this.prisma.calendarToken.findFirst({ where: { userId, workspaceId: auth.workspaceId } });
    if (!token) return { connected: false };
    await this.prisma.$transaction(async (tx) => {
      await tx.calendarToken.delete({ where: { id: token.id } });
      await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'integration.disconnected', targetType: 'calendarToken', targetId: userId, before: { provider: 'GOOGLE', email: token.email }, after: null });
    });
    this.realtime.toWorkspace(auth.workspaceId, 'integration:status', { provider: 'GOOGLE', status: 'DISCONNECTED', userId });
    return { connected: false };
  }

  /** I3.7: calendar connection status per employee, so a booking form can say why someone cannot be booked. */
  async status(auth: AuthContext) {
    const tokens = await this.prisma.calendarToken.findMany({ where: { workspaceId: auth.workspaceId }, select: { userId: true, email: true, status: true, lastError: true, updatedAt: true } });
    const mine = tokens.find((token) => token.userId === auth.userId) ?? null;
    return { configured: this.google.configured, mine, users: hasPermission(auth, 'integrations.view') ? tokens : tokens.map((token) => ({ userId: token.userId, status: token.status })) };
  }

  // ───────────── Busy times (I3.4) ─────────────

  async busy(auth: AuthContext, userId: string, from: Date, to: Date): Promise<{ busy: BusyInterval[]; source: 'google+platform' | 'platform' }> {
    const token = await this.tokenFor(auth.workspaceId, userId, false);
    const local = await this.prisma.appointment.findMany({ where: { workspaceId: auth.workspaceId, userId, status: 'SCHEDULED', startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } });
    const platformBusy = local.map((row) => ({ start: row.startsAt, end: row.endsAt }));
    if (!token) return { busy: platformBusy, source: 'platform' };
    try {
      const googleBusy = await this.google.freeBusy(decrypt(token.refreshTokenEnc, this.env.APP_ENCRYPTION_KEY), from, to);
      await this.markTokenOk(token.id);
      return { busy: [...googleBusy, ...platformBusy].sort((a, b) => a.start.getTime() - b.start.getTime()), source: 'google+platform' };
    } catch (error) {
      await this.handleGoogleError(auth.workspaceId, token.id, error);
      throw error;
    }
  }

  // ───────────── Appointments (I3.3, I3.5, I3.6) ─────────────

  async book(auth: AuthContext, input: { contactId: string; opportunityId?: string | null; userId?: string; title: string; description?: string; startsAt: string; endsAt: string; timeZone: string; force?: boolean }) {
    const userId = input.userId ?? auth.userId;
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (!(startsAt < endsAt)) throw new DomainError('INVALID_RANGE', 'The appointment must end after it starts.', 422);
    const contact = await this.prisma.contact.findFirst({ where: { id: input.contactId, workspaceId: auth.workspaceId } });
    if (!contact) throw new NotFoundException({ code: 'CONTACT_NOT_FOUND', message: 'Contact not found.' });
    if (input.opportunityId) {
      const opportunity = await this.prisma.opportunity.findFirst({ where: { id: input.opportunityId, workspaceId: auth.workspaceId } });
      if (!opportunity) throw new NotFoundException({ code: 'OPPORTUNITY_NOT_FOUND', message: 'Opportunity not found.' });
    }
    const token = await this.tokenFor(auth.workspaceId, userId, true);

    // I3.4: read busy times and block overlaps unless the caller explicitly overrides after seeing the warning
    const { busy } = await this.busy(auth, userId, startsAt, endsAt);
    const conflicts = busy.filter((interval) => interval.start < endsAt && interval.end > startsAt);
    if (conflicts.length > 0 && !input.force) {
      throw new DomainError('TIME_CONFLICT', `The employee is busy during this slot (${conflicts.map((c) => `${c.start.toISOString()} – ${c.end.toISOString()}`).join(', ')}).`, 409, 'Pick another time, or confirm to book anyway.');
    }

    let googleEventId: string | null = null;
    try {
      const created = await this.google.createEvent(decrypt(token.refreshTokenEnc, this.env.APP_ENCRYPTION_KEY), { title: input.title, description: input.description, startsAt, endsAt, timeZone: input.timeZone, attendeeEmail: contact.email ?? undefined });
      googleEventId = created.eventId;
      await this.markTokenOk(token.id);
    } catch (error) {
      await this.handleGoogleError(auth.workspaceId, token.id, error);
      throw error;
    }

    const appointment = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.appointment.create({
        data: { workspaceId: auth.workspaceId, contactId: contact.id, opportunityId: input.opportunityId ?? null, userId, title: input.title, startsAt, endsAt, timeZone: input.timeZone, googleEventId, status: 'SCHEDULED', createdById: auth.userId },
        include: APPOINTMENT_INCLUDE,
      });
      await this.activities.logTx(tx, { workspaceId: auth.workspaceId, entityType: input.opportunityId ? 'OPPORTUNITY' : 'CONTACT', entityId: input.opportunityId ?? contact.id, type: 'appointment', actorId: auth.userId, payload: { appointmentId: saved.id, action: 'booked', startsAt, endsAt, timeZone: input.timeZone, userId } });
      return saved;
    });
    await this.events.record({ workspaceId: auth.workspaceId, provider: 'GOOGLE', direction: 'OUT', type: 'event.created', externalEventId: googleEventId ? `out:${googleEventId}` : null, payload: { appointmentId: appointment.id }, relatedType: 'appointment', relatedId: appointment.id });
    if (input.opportunityId) this.domainEvents.emit('opportunity.activity', { workspaceId: auth.workspaceId, opportunityId: input.opportunityId, actorId: auth.userId, type: 'appointment' });
    const lead = await this.prisma.lead.findFirst({ where: { workspaceId: auth.workspaceId, contactId: contact.id, status: 'ASSIGNED' } });
    if (lead) this.activities.notifyLeadActivity(auth.workspaceId, lead.id, auth.userId, 'appointment');
    this.realtime.toWorkspace(auth.workspaceId, 'appointment:updated', { appointmentId: appointment.id, status: 'SCHEDULED', userId, contactId: contact.id });
    return appointment;
  }

  async reschedule(auth: AuthContext, id: string, input: { startsAt: string; endsAt: string; timeZone?: string; title?: string; force?: boolean; version?: number }) {
    const appointment = await this.getOrThrow(auth, id);
    if (appointment.status === 'CANCELLED') throw new DomainError('APPOINTMENT_CANCELLED', 'A cancelled appointment cannot be rescheduled.', 409, 'Book a new appointment instead.');
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (!(startsAt < endsAt)) throw new DomainError('INVALID_RANGE', 'The appointment must end after it starts.', 422);
    const timeZone = input.timeZone ?? appointment.timeZone;
    const token = await this.tokenFor(auth.workspaceId, appointment.userId, true);
    const { busy } = await this.busy(auth, appointment.userId, startsAt, endsAt);
    const conflicts = busy.filter((interval) => interval.start < endsAt && interval.end > startsAt && !(interval.start.getTime() === appointment.startsAt.getTime() && interval.end.getTime() === appointment.endsAt.getTime()));
    if (conflicts.length > 0 && !input.force) throw new DomainError('TIME_CONFLICT', 'The employee is busy during the new slot.', 409, 'Pick another time, or confirm to book anyway.');

    if (appointment.googleEventId) {
      try {
        await this.google.updateEvent(decrypt(token.refreshTokenEnc, this.env.APP_ENCRYPTION_KEY), appointment.googleEventId, { title: input.title ?? appointment.title, startsAt, endsAt, timeZone, attendeeEmail: appointment.contact.email ?? undefined });
        await this.markTokenOk(token.id);
      } catch (error) {
        await this.handleGoogleError(auth.workspaceId, token.id, error);
        throw error;
      }
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.appointment.updateMany({ where: { id, workspaceId: auth.workspaceId, ...(input.version ? { version: input.version } : {}) }, data: { startsAt, endsAt, timeZone, title: input.title ?? appointment.title, version: { increment: 1 } } });
      if (result.count === 0) throw new DomainError('VERSION_CONFLICT', 'This appointment was changed by someone else. Reload and try again.', 409);
      const saved = await tx.appointment.findUniqueOrThrow({ where: { id }, include: APPOINTMENT_INCLUDE });
      await this.activities.logTx(tx, { workspaceId: auth.workspaceId, entityType: appointment.opportunityId ? 'OPPORTUNITY' : 'CONTACT', entityId: appointment.opportunityId ?? appointment.contactId, type: 'appointment', actorId: auth.userId, payload: { appointmentId: id, action: 'rescheduled', from: { startsAt: appointment.startsAt, endsAt: appointment.endsAt }, to: { startsAt, endsAt }, timeZone } });
      return saved;
    });
    await this.events.record({ workspaceId: auth.workspaceId, provider: 'GOOGLE', direction: 'OUT', type: 'event.updated', payload: { appointmentId: id }, relatedType: 'appointment', relatedId: id });
    this.realtime.toWorkspace(auth.workspaceId, 'appointment:updated', { appointmentId: id, status: 'SCHEDULED', userId: appointment.userId, contactId: appointment.contactId });
    return updated;
  }

  async cancel(auth: AuthContext, id: string) {
    const appointment = await this.getOrThrow(auth, id);
    if (appointment.status === 'CANCELLED') return appointment;
    if (appointment.googleEventId) {
      const token = await this.prisma.calendarToken.findFirst({ where: { userId: appointment.userId, workspaceId: auth.workspaceId } });
      if (token) {
        try {
          await this.google.deleteEvent(decrypt(token.refreshTokenEnc, this.env.APP_ENCRYPTION_KEY), appointment.googleEventId);
          await this.markTokenOk(token.id);
        } catch (error) {
          await this.handleGoogleError(auth.workspaceId, token.id, error);
          throw error;
        }
      }
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.appointment.update({ where: { id }, data: { status: 'CANCELLED', version: { increment: 1 } }, include: APPOINTMENT_INCLUDE });
      await this.activities.logTx(tx, { workspaceId: auth.workspaceId, entityType: appointment.opportunityId ? 'OPPORTUNITY' : 'CONTACT', entityId: appointment.opportunityId ?? appointment.contactId, type: 'appointment', actorId: auth.userId, payload: { appointmentId: id, action: 'cancelled', startsAt: appointment.startsAt } });
      await this.audit.recordTx(tx, { workspaceId: auth.workspaceId, actorId: auth.userId, actorLabel: actorLabel(auth), action: 'appointment.cancelled', targetType: 'appointment', targetId: id, before: { status: 'SCHEDULED', startsAt: appointment.startsAt }, after: { status: 'CANCELLED' } });
      return saved;
    });
    await this.events.record({ workspaceId: auth.workspaceId, provider: 'GOOGLE', direction: 'OUT', type: 'event.deleted', payload: { appointmentId: id }, relatedType: 'appointment', relatedId: id });
    this.realtime.toWorkspace(auth.workspaceId, 'appointment:updated', { appointmentId: id, status: 'CANCELLED', userId: appointment.userId, contactId: appointment.contactId });
    return updated;
  }

  async list(auth: AuthContext, query: Pagination & { from?: string; to?: string; userId?: string; contactId?: string; status?: 'SCHEDULED' | 'CANCELLED' }) {
    const where: Prisma.AppointmentWhereInput = {
      workspaceId: auth.workspaceId,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { startsAt: { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } } : {}),
      ...(hasPermission(auth, 'leads.view_all') ? {} : { userId: auth.userId }),
      ...cursorWhere(query.cursor),
    };
    const rows = await this.prisma.appointment.findMany({ where, include: APPOINTMENT_INCLUDE, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: skipFor(query), take: query.limit + 1 });
    return pageResult(rows, query.limit);
  }

  // ───────────── helpers ─────────────

  private async getOrThrow(auth: AuthContext, id: string) {
    const appointment = await this.prisma.appointment.findFirst({ where: { id, workspaceId: auth.workspaceId }, include: APPOINTMENT_INCLUDE });
    if (!appointment) throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' });
    if (appointment.userId !== auth.userId && appointment.createdById !== auth.userId && !hasPermission(auth, 'leads.view_all')) {
      throw new ForbiddenException({ code: 'NOT_YOUR_APPOINTMENT', message: 'This appointment belongs to another employee.' });
    }
    return appointment;
  }

  /** I3.7: an employee without a connected calendar cannot be booked, and the error says why. */
  private tokenFor(workspaceId: string, userId: string, required: true): Promise<{ id: string; refreshTokenEnc: string; status: string }>;
  private tokenFor(workspaceId: string, userId: string, required: false): Promise<{ id: string; refreshTokenEnc: string; status: string } | null>;
  private async tokenFor(workspaceId: string, userId: string, required: boolean): Promise<{ id: string; refreshTokenEnc: string; status: string } | null> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, workspaceId, isActive: true }, select: { firstName: true } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Employee not found.' });
    const token = await this.prisma.calendarToken.findFirst({ where: { userId, workspaceId } });
    if (!token && required) throw new DomainError('CALENDAR_NOT_CONNECTED', `${user.firstName} has not connected a Google Calendar, so no appointment can be booked for them.`, 409, 'Ask them to connect Google Calendar in Settings → Integrations.');
    if (token?.status === 'NEEDS_RECONNECT' && required) throw new DomainError('CALENDAR_NEEDS_RECONNECT', `${user.firstName}'s Google connection expired or was revoked.`, 409, 'Ask them to reconnect Google Calendar.');
    return token;
  }

  private async markTokenOk(tokenId: string) {
    await this.prisma.calendarToken.update({ where: { id: tokenId }, data: { status: 'CONNECTED', lastError: null } });
  }

  /** I3.2: a revoked or expired connection is detected and shown as needing reconnection. */
  private async handleGoogleError(workspaceId: string, tokenId: string, error: unknown) {
    const message = (error as Error).message;
    if (error instanceof GoogleReconnectRequired) {
      const token = await this.prisma.calendarToken.update({ where: { id: tokenId }, data: { status: 'NEEDS_RECONNECT', lastError: message } });
      this.realtime.toUser(token.userId, 'notification', { title: 'Reconnect Google Calendar', body: message, link: '/settings/integrations' });
      this.realtime.toWorkspace(workspaceId, 'integration:status', { provider: 'GOOGLE', status: 'NEEDS_RECONNECT', userId: token.userId });
    } else {
      await this.prisma.calendarToken.update({ where: { id: tokenId }, data: { lastError: message } });
    }
    await this.connections.markHealth(workspaceId, 'GOOGLE', false, message);
    await this.events.record({ workspaceId, provider: 'GOOGLE', direction: 'OUT', type: 'request.failed', payload: { message } });
  }
}
