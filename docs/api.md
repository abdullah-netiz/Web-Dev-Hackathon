# API reference (backend v0.1)

Base URL: `http://localhost:4000` locally. All request and response bodies are JSON unless noted.

## Conventions

- **Auth**: `Authorization: Bearer <token>` (token from `POST /auth/login` or `/auth/signup`). The server also sets an `sid` cookie for same-origin use. Sessions idle out after 24 h and expire after 7 days.
- **Success envelope**: `{ "data": ... }`. List endpoints return `{ "data": [...], "meta": { "nextCursor": string|null, "hasMore": boolean, "total"?: number } }`. Pass `?cursor=<nextCursor>&limit=50` (max 100) to page.
- **Error envelope**: `{ "code": "SOME_CODE", "message": "What went wrong", "action"?: "What to do", "details"?: [{ "path", "message" }] }`. Status codes: 400 validation, 401 not signed in, 403 permission, 404 not found (also for records of other workspaces), 409 conflict / rule violation / version conflict, 422 business rule, 429 throttled, 502 provider failure.
- **Optimistic concurrency**: editable records carry `version`. Send it in PATCH bodies; a stale version returns `409 VERSION_CONFLICT`.
- **Permissions**: `GET /meta/permissions` lists keys. Owner and Admin hold every permission. Users hold their role's permissions. `GET /auth/me` returns the effective list.
- **Value masking**: callers without `crm.view_values` receive `value: null` plus `valueHidden: true` on opportunities and payments, in lists, details, dashboard and CSV export.
- **Filters** on list endpoints: `?filters=<url-encoded JSON>` with shape `{ "logic": "AND"|"OR", "criteria": [{ "field", "op", "value" }], "search"?: string }`. Ops: `eq, neq, contains, in, gte, lte, between, isNull, notNull, hasTag, isTrue, isFalse`. Fields: built-ins (`firstName, lastName, name, email, phone, companyId, contactId, ownerId, stageId, pipelineId, currentAssigneeId, tags, status, source, paymentStatus, recoveryReason, optedOut, createdAt, updatedAt, closeDate, dueAt, value`) or `custom.<key>`. `?search=` is a shortcut for name/email/phone search. `?listId=<savedListId>` applies a saved list.
- **Real-time**: Socket.IO at the API origin. Get a token with `GET /auth/ws-token` (valid 60 s), then `io(API_URL, { auth: { token }, transports: ['websocket'] })`. On `connect` the server emits `ready`. Events: `lead:created, lead:assigned, lead:acknowledged, lead:escalated, lead:reassigned, lead:updated, lead:recovery, message:new, message:status, payment:updated, appointment:updated, availability:changed, integration:status, notification` (personal: `{ title, body, link }`). On every reconnect, refetch open queries.

## Auth

| Method | Path | Body / notes |
|---|---|---|
| POST | `/auth/signup` | `{ workspaceName, firstName, lastName, email, password, timeZone? }` → creates workspace + Owner; returns `{ token, expiresAt, user, workspace }` |
| POST | `/auth/login` | `{ email, password }` → `{ token, expiresAt, user, workspace }`; 5 attempts/min per IP |
| POST | `/auth/logout` | revokes the current session |
| GET | `/auth/me` | `{ userId, workspaceId, email, name, baseLevel, roleName, permissions[] }` |
| GET | `/auth/sessions` · DELETE `/auth/sessions/:id` · POST `/auth/sessions/revoke-others` | session management |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` (revokes other sessions) |
| GET | `/auth/ws-token` | `{ token, expiresInSec }` for Socket.IO |
| GET | `/meta/permissions` · `/meta/enums` | public vocabularies |
| GET | `/health` | public |

## Workspace, users, roles

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/workspace` | any | includes lead-engine settings |
| PATCH | `/workspace` | `settings.manage` | `{ name?, currency?, timeZone?, ackWindowSec?, escalationLevels?, levelWindowSec?, idleSec?, maxOpenLeadsDefault?, acknowledgedLeadsOnAbsence? }` (seconds) |
| GET | `/users?includeInactive=` | any | each user: `baseLevel, role, availability, maxOpenLeads, backupUserId, isManager, slackLinked, slackUserId, version` |
| POST | `/users` | `users.manage` | `{ email, firstName, lastName, baseLevel?: 'ADMIN'\|'USER', roleId?, timeZone? }` → `{ user, temporaryPassword }` (show once) |
| GET | `/users/:id` | any | |
| PATCH | `/users/:id` (or `me`) | self for profile; `users.manage` for role/level/limits | `{ firstName?, lastName?, baseLevel?, roleId?, maxOpenLeads?, backupUserId?, timeZone?, version? }`; Admin cannot modify Owner; only Owner grants Admin |
| PATCH | `/users/:id/availability` (or `me`) | self or `users.manage` | `{ availability: 'AVAILABLE'\|'BUSY'\|'ON_LEAVE'\|'OFFLINE' }`; ON_LEAVE/OFFLINE reassigns pending leads |
| DELETE | `/users/:id` | `users.manage` | deactivates; pending leads reassigned |
| GET | `/roles` | any | `{ id, name, description, permissions[], isSystem, userCount, isManager }` |
| POST | `/roles` · PATCH `/roles/:id` · DELETE `/roles/:id` | `roles.manage` | `{ name, description?, permissions[] }` |

## CRM

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/companies` · `/companies/:id` | `crm.view` | detail includes contacts + opportunities |
| POST | `/companies` | `crm.create` | `{ name, domain?, ownerId?, custom? }` |
| PATCH | `/companies/:id` · DELETE | `crm.edit` / `crm.delete` | |
| GET | `/contacts` | `crm.view` | paginated, filters, `total` |
| GET | `/contacts/:id` | `crm.view` | |
| GET | `/contacts/:id/overview` | `crm.view` | `{ contact, opportunities, leads, conversations, payments, appointments, timeline }` (F2.8) |
| GET | `/contacts/:id/activities` | `crm.view` | combined timeline, paginated |
| GET | `/contacts/export.csv?filters=` | `crm.view`+`crm.export` | CSV; value permission applied |
| POST | `/contacts` | `crm.create` | `{ firstName, lastName?, email?, phone? (E.164), companyId?, ownerId?, tags?, custom? }`; phone unique per workspace |
| PATCH | `/contacts/:id` | `crm.edit` | also `optedOut`; `version` |
| DELETE | `/contacts/:id` | `crm.delete` | refused (409) while related records exist |
| GET | `/opportunities?pipelineId=` | `crm.view` | |
| GET | `/opportunities/board?pipelineId=` | `crm.view` | `{ pipeline, stages: [{ ...stage, opportunities[], totalValue }] }` |
| GET | `/opportunities/:id` | `crm.view` | includes payments, appointments, leads, `customFieldDefinitions` for its pipeline |
| GET | `/opportunities/:id/activities` · `/opportunities/export.csv` | | |
| POST | `/opportunities` | `crm.create` | `{ name, contactId, companyId?, pipelineId?, stageId?, ownerId?, value?, currency?, closeDate?, custom? }` |
| PATCH | `/opportunities/:id` | `crm.edit` | editing `value` also needs `crm.view_values` |
| POST | `/opportunities/:id/move` | `crm.edit` | `{ stageId, version? }`; `422 STAGE_REQUIREMENTS_UNMET` lists missing fields |
| DELETE | `/opportunities/:id` | `crm.delete` | refused while payments exist |
| POST | `/:entity/:id/notes` | `crm.edit` | entity ∈ `contacts, companies, opportunities, leads`; `{ body }`; a note on a lead by its assignee acknowledges it |
| GET | `/custom-fields?entity=&includeArchived=` | `crm.view` | |
| POST | `/custom-fields` | `settings.manage` | `{ entity, label, type: TEXT\|NUMBER\|DATE\|DROPDOWN\|CHECKBOX, options?, pipelineId?, isRequired? }` → `key` derived from label |
| PATCH | `/custom-fields/:id` · DELETE (archive) | `settings.manage` | |
| GET | `/pipelines` | `crm.view` | stages ordered, with opportunity counts |
| POST | `/pipelines` | `settings.manage` | `{ name, stages?: string[] }` |
| POST | `/pipelines/:id/stages` | `settings.manage` | `{ name, isWon?, isLost?, requiredFieldKeys?, color? }` |
| PUT | `/pipelines/:id/stages/order` | `settings.manage` | `{ stageIds: [...] }` full ordered list |
| PATCH | `/stages/:id` | `settings.manage` | |
| DELETE | `/stages/:id?moveToStageId=` | `settings.manage` | `409 STAGE_NOT_EMPTY` without a target |
| GET/POST | `/saved-lists?entity=` | `crm.view` | `{ entity, name, filters, isShared? }` |
| PATCH/DELETE | `/saved-lists/:id` | owner or Admin | |

## Leads (F3)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/f/:workspaceSlug` | public | HTML intake form |
| POST | `/intake/:workspaceSlug` | public, 10/min | `{ firstName, lastName?, email?, phone?, message }` → `{ reference, leadId }` |
| GET | `/leads?status=&mine=&filters=` | any | Users without `leads.view_all` see only their own |
| GET | `/leads/recovery` | any | recovery queue; `meta.byReason` counts (`OVERDUE, ESCALATED_TWICE, IDLE`) |
| GET | `/leads/:id` | any (own or `leads.view_all`) | includes `assignments[]`, `remainingSec`, `dueAt`, `recoveryReason`, `timeToFirstResponseSec` |
| GET | `/leads/:id/activities` | | |
| POST | `/leads` | `crm.create` | `{ title, notes?, contactId? \| contact: { firstName, lastName?, email?, phone? }, opportunityId? }` → assigned immediately |
| POST | `/leads/:id/acknowledge` | assignee or `leads.reassign` | stops the timer |
| POST | `/leads/:id/reassign` | `leads.reassign` | `{ toUserId, reason? }` |
| POST | `/leads/:id/close` | assignee or `leads.reassign` | `{ reason }` |

Lead status: `NEW → ASSIGNED → ACKNOWLEDGED → CLOSED`. `dueAt` is the acknowledgement deadline; render a countdown from it. Escalation levels: 1 next available, 2 backup, 3 manager (configurable count).

## Dashboard (F5)

- `GET /dashboard` → `{ scope: 'company'|'personal', widgets: { newLeadsToday, openPipelineValueByStage, avgTimeToFirstResponseSec, recoveryQueueCount, escalationsLast24h, employeeAvailability, upcomingAppointments, paymentsReceivedThisMonth, projectedRevenue }, hiddenWidgets[], availableWidgets[] }`. Each widget has `value` and `drillDown: { endpoint, query }` to pass to the matching list endpoint.
- `PUT /dashboard/prefs` `{ hiddenWidgets: string[] }`.

## Audit (F4)

- `GET /audit?action=&actorId=&targetType=&from=&to=` (`audit.view`) — paginated; `GET /audit/actions` for the filter list. No write endpoints exist.

## Messaging (I1)

| Method | Path | Notes |
|---|---|---|
| GET | `/conversations` | with `lastMessage`, `canReply`, `unreadCount` |
| GET | `/conversations/:id` | `canReply`, `replyBlockedReason` (opt-out or 24 h window) |
| GET | `/conversations/:id/messages` | marks read |
| POST | `/conversations/:id/messages` | `{ body }` (`crm.edit`); message starts `QUEUED`, then `SENT/DELIVERED/READ/FAILED` via `message:status` |
| POST | `/contacts/:id/messages` | start a WhatsApp conversation with a contact |
| POST | `/messages/:id/retry` | retry a `FAILED` message |
| POST | `/conversations/:id/assign` | `{ userId }` (`leads.reassign`) |

## Payments (I2)

- `POST /opportunities/:id/payment-requests` `{ amount, currency?, description?, expiresInMinutes? }` (`crm.edit`) → payment with `checkoutUrl` to send to the customer.
- `GET /payments?status=&from=&to=&opportunityId=` · `GET /payments/:id`. Status (`PENDING, PAID, EXPIRED, FAILED, REFUNDED, PARTIALLY_REFUNDED`) changes only through Lemon Squeezy webhooks (plus `EXPIRED` when an unpaid link passes its deadline); listen to `payment:updated`. Amounts are in the store currency; sending a different `currency` returns `422 CURRENCY_MISMATCH`.
- Lemon Squeezy test card: `4242 4242 4242 4242`, any future date, any CVC.

## Calendar (I3)

| Method | Path | Notes |
|---|---|---|
| GET | `/calendar/google/connect` | `{ url }` → navigate the browser there; Google redirects to `/calendar/google/callback` then to `APP_URL/settings/integrations?google=connected\|denied\|failed` |
| DELETE | `/calendar/google?userId=` | disconnect (own, or `integrations.manage`) |
| GET | `/calendar/status` | `{ configured, mine, users: [{ userId, status }] }` — `status` ∈ `CONNECTED, NEEDS_RECONNECT` |
| GET | `/calendar/busy?userId=&from=&to=` | busy intervals (Google + platform) |
| GET | `/appointments?from=&to=&userId=&contactId=&status=` | |
| POST | `/appointments` | `{ contactId, opportunityId?, userId?, title, description?, startsAt, endsAt, timeZone, force? }`; `409 TIME_CONFLICT` unless `force: true`; `409 CALENDAR_NOT_CONNECTED` with the reason |
| PATCH | `/appointments/:id` | `{ startsAt, endsAt, timeZone?, title?, force?, version? }` |
| DELETE | `/appointments/:id` | cancel (removes the Google event) |

## Alerts (I4) and integrations (I5)

| Method | Path | Notes |
|---|---|---|
| PUT | `/alerts/slack/link` | `{}` finds the Slack member by the user's email, or `{ slackUserId: "U0123ABCD" }`; Admins may add `userId`. Sends a test DM. `404 SLACK_USER_NOT_FOUND` asks for the member ID |
| GET | `/alerts/slack/status` · DELETE `/alerts/slack/link` | `{ configured, linked, slackUserId }` |
| GET | `/alerts?status=` | delivery attempts (`integrations.view` sees all) |
| GET | `/integrations` | per provider: `status, lastOkAt, lastError, maskedCredentials, limits[], purpose, webhookUrl, statusCallbackUrl, details` |
| PUT | `/integrations/:provider` | `twilio`: `{ credentials: { accountSid, authToken, whatsappFrom } }`; `lemonsqueezy`: `{ credentials: { apiKey, storeId, variantId, webhookSecret }, config: { currency: "USD" } }`; `slack`: `{ credentials: { botToken } }` (`integrations.manage`) |
| DELETE | `/integrations/:provider` | disconnect |
| GET | `/integrations/events?provider=&status=` | sync history (`integrations.view`) |

Webhook URLs to register with providers (shown on `GET /integrations`): Twilio `POST {PUBLIC_URL}/webhooks/twilio/{workspaceId}` and status callback `.../status`; Lemon Squeezy `POST {PUBLIC_URL}/webhooks/lemonsqueezy/{workspaceId}` (events `order_created`, `order_refunded`). Slack and Google need no webhook.
