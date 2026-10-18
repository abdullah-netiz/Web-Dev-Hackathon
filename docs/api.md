# API contract — v1

The frontend builds against this document. New endpoint = a Zod schema in
`backend/src/<module>/dto` **and** an entry here, in the same PR (AGENTS §8).

Base URL: `http://localhost:4000` in development, the Railway URL in production.

## Response envelope

Every success response is:

```jsonc
{ "data": <payload>, "meta": { /* optional: pagination, counts */ } }
```

Every error response is:

```jsonc
{
  "code": "validation_error",
  "message": "The request contains invalid or missing data.",
  "action": "Correct the highlighted fields and try again.",   // optional, user-facing next step
  "details": [{ "path": "email", "message": "Invalid email address" }] // optional
}
```

`message` says what went wrong; `action` says what to do about it (Q10). Always
render both. Error codes in use: `validation_error`, `unauthenticated`,
`invalid_credentials`, `forbidden`, `not_found`, `conflict`, `database_error`,
`too_many_requests`, `unavailable`, `internal_error`.

## Authentication

`POST /auth/login` returns an opaque bearer token. Send it on every subsequent
request:

```
Authorization: Bearer <token>
```

Sessions are revocable and expire (idle 8 hours, absolute 30 days). A `401`
means the token is missing, expired, revoked, or the user was deactivated —
re-authenticate. A `403` means the session is valid but the permission is missing.

---

## Meta

### `GET /meta/permissions` — public

Returns the permission catalogue. Render role editors from this, so the UI and the
API never disagree.

```jsonc
{ "data": [ { "key": "crm.edit", "label": "Edit CRM records", "group": "CRM" } ] }
```

Permission keys: `crm.view`, `crm.view_values`, `crm.create`, `crm.edit`,
`crm.delete`, `crm.configure`, `leads.view`, `leads.reassign`,
`integrations.manage`, `integrations.view_logs`, `workspace.manage`,
`users.manage`, `roles.manage`, `dashboard.view`, `audit.view`.

## Health

### `GET /health` — public
`{ "data": { "status": "ok" } }`

### `GET /health/ready` — public
`{ "data": { "status": "ok", "database": "up" } }` — `503` when the database is unreachable.

## Auth

### `POST /auth/login` — public, rate limited (5/min per email + IP)

Request:

```jsonc
{ "email": "owner@demo.test", "password": "Password123!" }
```

`200` response:

```jsonc
{
  "data": {
    "token": "…",
    "user": {
      "id": "…", "workspaceId": "…", "email": "owner@demo.test", "name": "Demo Owner",
      "baseLevel": "OWNER", "availability": "AVAILABLE",
      "roleId": "…", "roleName": "Owner",
      "permissions": ["crm.view", "…"]
    }
  }
}
```

Failures: `400 validation_error` (bad shape), `401 invalid_credentials` (generic —
never reveals whether the email exists), `429 too_many_requests` after 5 attempts.

### `POST /auth/signup` — public, rate limited (5/min per email + IP)

Creates a new company workspace and makes the caller its **Owner** in one transaction
(F1.1). The workspace is provisioned with settings and two built-in roles (`Admin`, `User`);
later members are invited through `/members`.

```jsonc
{ "workspaceName": "Acme Services", "name": "Omar Owner",
  "email": "omar@acme.test", "password": "Password123!" }
```

`201` returns the same `{ data: { token, user } }` shape as login, with `user.baseLevel: "OWNER"`
and the full permission list. `409 conflict` if the email already has an account.

### `POST /auth/logout`
Revokes the current session. `{ "data": { "ok": true } }`. The token is dead afterwards.

### `GET /auth/me`
Returns the signed-in user with their effective `permissions` and `sessionId`. Use
this on app load to hydrate the session and to drive permission-gated UI.

---

## Lists, pagination and optimistic concurrency (Q4, Q9)

Every list endpoint accepts:

| Param | Meaning |
|---|---|
| `limit` | 1–100, default 25 |
| `cursor` | opaque id from `meta.nextCursor`; omit for the first page |
| `q` | optional search term |

List responses are `{ "data": [...], "meta": { "nextCursor": "…" \| null, "hasMore": true } }`.
Pass `meta.nextCursor` as `cursor` to fetch the next page; stop when `hasMore` is `false`.

Editable records carry a `version`. Send the `version` you last read on `PATCH`; if it is
stale the update returns `409 conflict` and you must reload before retrying.

## Companies — `/companies`

Fields: `name` (required), `domain`, `phone`, `address`, `notes`, `tags`, `custom`.
Permission gate: read `crm.view`, create `crm.create`, edit `crm.edit`, delete `crm.delete`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/companies` | list (`limit`/`cursor`/`q`) |
| `GET` | `/companies/:id` | single, `404` if absent/other workspace |
| `POST` | `/companies` | `201`; body above |
| `PATCH` | `/companies/:id` | body + `version`; `409` on stale version |
| `DELETE` | `/companies/:id` | `{ "data": { "ok": true } }` |

## Contacts — `/contacts`

Fields: `firstName` (required), `lastName`, `email`, `phone`, `companyId`, `ownerId`,
`optedOut`, `tags`, `custom`. `GET /contacts` also accepts `companyId` as a filter.
Same permission gate as companies. A `companyId` from another workspace is rejected with
`409 conflict`; a duplicate `phone` returns `409 conflict`.

## Opportunities — `/opportunities`

Fields: `name` (required), `companyId`, `contactId`, `pipelineId`, `stageId`, `ownerId`,
`value`, `currency`, `closeDate`, `description`, `custom`. `GET /opportunities` also
accepts `stageId` and `ownerId` filters.

**Value redaction (F1.4):** the `value` field is only present when the caller has
`crm.view_values`. Without it, `value` is omitted from both list and single responses
(and from totals). The UI must read the permission, not assume the key exists.

## Pipelines & stages — `/pipelines`

All routes require `crm.configure` (read requires `crm.view`).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/pipelines` | pipelines with their stages, ordered |
| `GET` | `/pipelines/:id` | one pipeline with stages |
| `POST` | `/pipelines` | `{ name, isDefault }` |
| `PATCH` | `/pipelines/:id` | `{ name?, isDefault?, version }` |
| `DELETE` | `/pipelines/:id` | `409` while the pipeline still holds opportunities (F2.5) |
| `POST` | `/pipelines/:id/stages` | `{ name, order?, isWon?, isLost?, requiredFieldKeys? }` |
| `PATCH` | `/pipelines/:id/stages/:stageId` | stage fields + `version` |
| `POST` | `/pipelines/:id/stages/reorder` | `{ stageIds: [...] }` — full new order |
| `DELETE` | `/pipelines/:id/stages/:stageId?moveToStageId=` | `moveToStageId` is **required**; its opportunities are moved there first |

Deleting a stage without `moveToStageId` is a `400 validation_error`. The response reports
how many opportunities were moved: `{ "data": { "movedOpportunities": 3 } }`.

## Custom fields — `/custom-fields` (F2.2)

Fields: `entity` (`CONTACT` \| `COMPANY` \| `OPPORTUNITY`), `key` (lower_snake_case, unique
per workspace), `label`, `type` (`TEXT` \| `NUMBER` \| `DATE` \| `SELECT` \| `CHECKBOX`),
`options` (required when `type` is `SELECT`), `required`, `pipelineId`, `order`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/custom-fields?entity=&includeArchived=` | archived fields are hidden unless `includeArchived=true` |
| `POST` | `/custom-fields` | `403` without `crm.configure`; `400` if a `SELECT` has no options |
| `PATCH` | `/custom-fields/:id` | editable fields + `version` |
| `DELETE` | `/custom-fields/:id` | **archives** (never deletes rows) so stored values stay readable |

## Activities — `/activities`

A timeline entry attached to a record. Fields: `entityType`, `entityId`, `type` (`NOTE`,
`CALL`, `EMAIL`, `MEETING`, `STAGE_CHANGE`, `FIELD_EDIT`, `ASSIGNMENT`, `ACKNOWLEDGEMENT`,
`ESCALATION`, `MESSAGE`, `PAYMENT`, `APPOINTMENT`, `SYSTEM`), `title`, `body`, `meta`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/activities?entityType=&entityId=&limit=&cursor=` | newest first |
| `POST` | `/activities` | requires `crm.create`; rejected if the target record is not in the workspace |

## Leads — `/leads` (F3, the core)

A lead must never be without an accountable owner. Assignment is round-robin over
members whose availability is `AVAILABLE` and who are under the open-lead cap; an
acknowledgement window is armed as a delayed job that escalates only while the
assignment is still `PENDING` (so two timers can never escalate the same lead twice).

`GET /leads` accepts `limit`/`cursor`/`q` plus `status`, `ownerId`, `unassigned=true`.
Each lead exposes `escalationCount`, `recoveryReason`, `timeToFirstResponseSec` and its
current `PENDING` assignment (with `dueAt`, so the UI can show remaining time).

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/leads` | `leads.view` | list |
| `GET` | `/leads/:id` | `leads.view` | detail incl. full assignment history |
| `GET` | `/leads/recovery` | `leads.view` | leads overdue, escalated more than once, or idle — each with a reason |
| `GET` | `/leads/settings` | `leads.view` | ack window, levels, open-lead cap, idle period |
| `PATCH` | `/leads/settings` | `workspace.manage` | edit the above + `version` |
| `POST` | `/leads` | `crm.create` | manual capture; passing `ownerId` also needs `leads.reassign` |
| `PATCH` | `/leads/:id` | `crm.edit` | edit fields + `version` |
| `POST` | `/leads/:id/assign` | `leads.reassign` | manual (re)assignment: `{ "ownerId": "…" }` |
| `POST` | `/leads/:id/acknowledge` | `leads.view` | only the current owner (or a reassigner) may acknowledge |
| `POST` | `/leads/:id/close` | `crm.edit` | closes the lead and cancels its timer |

### `POST /public/leads?workspace=<slug>` — public intake (F3.1)

No session. The hosted intake form posts here; body `{ name, phone?, email?, message? }`
with a phone **or** an email required. The workspace is resolved from the `?workspace=`
slug, so one public endpoint serves every tenant. Creates the lead with source `WEB_FORM`
and runs the same assignment flow.

## Members — `/users` (F3.2, F3.6)

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/users?availability=&roleId=` | `leads.view` | member list for assignment pickers |
| `PATCH` | `/users/:id/availability` | self, or `users.manage` | set `AVAILABLE` \| `BUSY` \| `ON_LEAVE` \| `OFFLINE` |

Setting a member to `ON_LEAVE` or `OFFLINE` immediately reassigns their unacknowledged
leads to someone available (F3.6); acknowledged leads are kept. Members who are not
`AVAILABLE` never receive new leads (F3.3).

## Workspace settings — `/workspace` (F1.3, F1.2, Q6)

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/workspace` | `workspace.manage` | name, `slug` (for the public intake form) and lead settings |
| `PATCH` | `/workspace` | `workspace.manage` | rename + tune `ackWindowSec`, `escalationLevels`, `idlePeriodSec`, `maxOpenLeads`, `acknowledgedOnLeavePolicy` |

`PATCH` uses optimistic concurrency: send the `version` from the last `GET`; a
stale value returns `409 conflict` (Q4). This is the general settings surface; the
lead-specific all-in-one lives at `/leads/settings`.

## Members — `/members` (F1.2, F1.7)

Only users with `users.manage` may see or change members.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/members?q=&baseLevel=&availability=&roleId=&includeInactive=` | paginated member directory |
| `POST` | `/members` | invite: `{ name, email, password, baseLevel: "ADMIN"\|"USER", roleId? }` |
| `PATCH` | `/members/:id` | `{ name?, baseLevel?, roleId?, telegramChatId?, availability?, version }` |
| `POST` | `/members/:id/deactivate` | blocks the Owner; revokes sessions; reassigns unacknowledged leads first |
| `POST` | `/members/:id/reactivate` | restores an active account |

Inviting without a `roleId` assigns the built-in role matching the level. An **Admin
cannot modify the Owner** and no one can deactivate the Owner or demote the last owner
(F1.2). Every change writes an audit event.

## Roles — `/roles` (F1.3)

`roles.manage` only (Owner, or any role granted it). Permissions are keys from
`GET /meta/permissions`; an unknown key is rejected with `400` so a rename can never
silently grant access.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/roles` | roles with their `permissions` and member `_count` |
| `POST` | `/roles` | `{ name, permissions: ["crm.view", …] }` |
| `PATCH` | `/roles/:id` | `{ name?, permissions?, version }` — built-in roles can be re-permissioned but not renamed |
| `DELETE` | `/roles/:id` | blocked (`409`) for built-in roles or roles still assigned to members |

## Dashboard — `/dashboard` (F5, Section 7)

Every figure is computed from one definition in `backend/src/metrics/definitions.ts`, so
the dashboard, lists and exports cannot disagree (F5.2). Each widget returns its label,
unit, value and a `drilldown` (`{ route, query }`) the UI can navigate to (F5.3).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/dashboard` | all figures; `?widgets=a,b` to fetch a subset |
| `GET` | `/dashboard/widgets` | the widget catalogue (key, label, definition, unit, personal) |
| `GET` | `/dashboard/prefs` | the caller's remembered visible figures (F5.5) |
| `PATCH` | `/dashboard/prefs` | `{ "widgets": ["leads_new_today", …] }` — unknown keys are ignored |

All require `dashboard.view`. Figures are **role-aware** (F5.4): an `USER` gets personal
figures (`scope: "personal"` — own leads, own response time, own appointments), while
`OWNER`/`ADMIN` get company-wide figures. Money figures (`pipeline_value_by_stage`,
`payments_this_month`) are `redacted: true` with `value: null` for callers lacking
`crm.view_values`.

```jsonc
{
  "data": {
    "scope": "workspace",
    "canSeeValues": true,
    "generatedAt": "…",
    "widgets": [
      { "key": "recovery_queue", "label": "Recovery queue", "unit": "count",
        "scope": "workspace", "value": 2, "drilldown": { "route": "/leads/recovery", "query": {} } }
    ]
  }
}
```

Widget keys: `leads_new_today`, `avg_first_response`, `recovery_queue`, `escalations_24h`,
`pipeline_value_by_stage`, `team_availability`, `upcoming_appointments`, `payments_this_month`.

## Audit — `/audit` (F4)

`GET /audit` (requires `audit.view`) returns the append-only history, newest first,
keyset-paginated. There is no update or delete route; the DB also rejects them.

```jsonc
{ "data": [ { "id": "…", "action": "company.updated", "actorLabel": "Demo Owner",
  "entityType": "company", "entityId": "…", "summary": "…", "createdAt": "…" } ],
  "meta": { "nextCursor": null, "hasMore": false } }
```

## Seed data (for frontend development)

`pnpm db:seed` creates workspace slug `demo`:

| Email | Password | Base level | Role |
|---|---|---|---|
| `owner@demo.test` | `Password123!` | OWNER | Owner (all permissions) |
| `admin@demo.test` | `Password123!` | ADMIN | Admin (all but `roles.manage`) |
| `sales@demo.test` | `Password123!` | USER | Sales (view/create/edit CRM + view leads) |

Seeded: 5 companies, 10 contacts, 12 opportunities across 5 pipeline stages, 4 leads
(one unassigned, one pending assignment, one acknowledged, one recovered/escalated).

## Planned next (not yet implemented)

`/integrations` (Twilio WhatsApp, Stripe, Google Calendar, Telegram) and the Socket.IO
real-time channel (Q11). Each will follow the same envelope, pagination and error shape.
