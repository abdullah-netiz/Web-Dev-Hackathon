import { Inject, Injectable } from '@nestjs/common';
import { google } from 'googleapis';

import { ENV, type Env } from '../../common/env';
import { DomainError } from '../../common/http-exception.filter';
import { ProviderError } from './twilio.provider';

export type BusyInterval = { start: Date; end: Date };
export type EventInput = { title: string; description?: string; startsAt: Date; endsAt: Date; timeZone: string; attendeeEmail?: string };

export interface CalendarProvider {
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<{ refreshToken: string; email: string | null }>;
  freeBusy(refreshToken: string, from: Date, to: Date): Promise<BusyInterval[]>;
  createEvent(refreshToken: string, input: EventInput): Promise<{ eventId: string; htmlLink: string | null }>;
  updateEvent(refreshToken: string, eventId: string, input: EventInput): Promise<void>;
  deleteEvent(refreshToken: string, eventId: string): Promise<void>;
}

const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy', 'https://www.googleapis.com/auth/userinfo.email'];

/**
 * Google Calendar through the OAuth 2.0 web-server flow (developers.google.com/identity/protocols/oauth2/web-server).
 * `access_type=offline` + `prompt=consent` so a refresh token is issued; access tokens refresh automatically (I3.2).
 */
@Injectable()
export class GoogleCalendarProvider implements CalendarProvider {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get configured(): boolean {
    return Boolean(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET);
  }

  private client(refreshToken?: string) {
    if (!this.configured) {
      throw new DomainError('GOOGLE_NOT_CONFIGURED', 'Google Calendar is not configured on this server.', 503, 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
    }
    const client = new google.auth.OAuth2(this.env.GOOGLE_CLIENT_ID, this.env.GOOGLE_CLIENT_SECRET, `${this.env.PUBLIC_URL}/calendar/google/callback`);
    if (refreshToken) client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  authUrl(state: string): string {
    return this.client().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state, include_granted_scopes: true });
  }

  async exchangeCode(code: string) {
    const client = this.client();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new DomainError('NO_REFRESH_TOKEN', 'Google did not return a refresh token.', 502, 'Remove the app from your Google account permissions and connect again.');
    }
    client.setCredentials(tokens);
    let email: string | null = null;
    try {
      const info = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
      email = info.data.email ?? null;
    } catch {
      email = null;
    }
    return { refreshToken: tokens.refresh_token, email };
  }

  /** developers.google.com/workspace/calendar/api/v3/reference/freebusy/query */
  async freeBusy(refreshToken: string, from: Date, to: Date): Promise<BusyInterval[]> {
    const calendar = google.calendar({ version: 'v3', auth: this.client(refreshToken) });
    try {
      const response = await calendar.freebusy.query({ requestBody: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: 'primary' }] } });
      const busy = response.data.calendars?.primary?.busy ?? [];
      return busy.filter((interval) => interval.start && interval.end).map((interval) => ({ start: new Date(interval.start as string), end: new Date(interval.end as string) }));
    } catch (error) {
      throw mapGoogleError(error);
    }
  }

  /** Times are sent as RFC3339 plus an IANA timeZone so Google handles DST (I3.5). */
  async createEvent(refreshToken: string, input: EventInput) {
    const calendar = google.calendar({ version: 'v3', auth: this.client(refreshToken) });
    try {
      const response = await calendar.events.insert({
        calendarId: 'primary',
        sendUpdates: input.attendeeEmail ? 'all' : 'none',
        requestBody: {
          summary: input.title,
          description: input.description,
          start: { dateTime: input.startsAt.toISOString(), timeZone: input.timeZone },
          end: { dateTime: input.endsAt.toISOString(), timeZone: input.timeZone },
          attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
        },
      });
      if (!response.data.id) throw new ProviderError('GOOGLE', 'NO_ID', 'Google did not return an event id.', false);
      return { eventId: response.data.id, htmlLink: response.data.htmlLink ?? null };
    } catch (error) {
      throw mapGoogleError(error);
    }
  }

  async updateEvent(refreshToken: string, eventId: string, input: EventInput) {
    const calendar = google.calendar({ version: 'v3', auth: this.client(refreshToken) });
    try {
      await calendar.events.patch({
        calendarId: 'primary',
        eventId,
        sendUpdates: input.attendeeEmail ? 'all' : 'none',
        requestBody: {
          summary: input.title,
          description: input.description,
          start: { dateTime: input.startsAt.toISOString(), timeZone: input.timeZone },
          end: { dateTime: input.endsAt.toISOString(), timeZone: input.timeZone },
        },
      });
    } catch (error) {
      throw mapGoogleError(error);
    }
  }

  async deleteEvent(refreshToken: string, eventId: string) {
    const calendar = google.calendar({ version: 'v3', auth: this.client(refreshToken) });
    try {
      await calendar.events.delete({ calendarId: 'primary', eventId, sendUpdates: 'all' });
    } catch (error) {
      const mapped = mapGoogleError(error);
      if (mapped.providerCode === '404' || mapped.providerCode === '410') return; // already gone
      throw mapped;
    }
  }
}

export class GoogleReconnectRequired extends ProviderError {
  constructor() {
    super('GOOGLE', 'invalid_grant', 'The Google connection expired or was revoked. The employee needs to reconnect their calendar.', false);
  }
}

function mapGoogleError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const googleError = error as { code?: number | string; message?: string; response?: { data?: { error?: string | { message?: string } } } };
  const data = googleError.response?.data?.error;
  const errorName = typeof data === 'string' ? data : data?.message ?? googleError.message ?? '';
  if (errorName.includes('invalid_grant')) return new GoogleReconnectRequired();
  const code = String(googleError.code ?? 'UNKNOWN');
  const retryable = code === '429' || (code === '403' && /usageLimits|rateLimitExceeded/i.test(errorName)) || Number(code) >= 500;
  return new ProviderError('GOOGLE', code, `Google Calendar: ${errorName || 'request failed'}`, retryable);
}
