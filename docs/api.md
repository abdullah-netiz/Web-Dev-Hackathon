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

### `POST /auth/logout`
Revokes the current session. `{ "data": { "ok": true } }`. The token is dead afterwards.

### `GET /auth/me`
Returns the signed-in user with their effective `permissions` and `sessionId`. Use
this on app load to hydrate the session and to drive permission-gated UI.

---

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

`/workspaces`, `/users`, `/roles`, `/contacts`, `/companies`, `/opportunities`,
`/pipelines`, `/custom-fields`, `/leads`, `/activities`, `/audit`, `/dashboard`,
`/integrations`. Each will follow the same envelope and error shape.
