# Integration checklist — hand-off for devA

> **Resolved on the `integration` branch (2026-10-18).** Kept as history. Current status: [`self-check.md`](./self-check.md).

> Written 2026-10-18. This is the "what is still pending and exactly what to change" note for integrating the
> frontend (`origin/taimoor`, devC) with the backend (`origin/backend`, devA) and the third-party providers.
> Full contract: [`docs/api.md`](./api.md). Requirement IDs: `docs/problem-statement.md`.

## 1. Branches and who owns what

| Branch | Author | Contents | Status |
|---|---|---|---|
| `origin/backend` | devA | Complete NestJS backend: accounts/RBAC, CRM, lead engine, audit, dashboard, Twilio/Stripe/Google/Telegram integrations, messaging, payments, calendar, alerts | **Done.** typecheck clean · 13/13 unit tests · 2 migrations + seed applied (6 users, 320 contacts, 60 opportunities) |
| `origin/taimoor` | devC | Frontend **Baton** (Next.js 16, React 19, Tailwind 4, Radix, TanStack Query/Table, Socket.IO client) | **Done in mock mode.** `src/lib/api/http.ts` (`live` mode) is a draft |
| `origin/feat/backend-scaffold` | devB + Claude | Parallel backend implementation | **Reference only — superseded by `origin/backend`. Do not merge.** Kept for the smoke suites |
| `origin/main` | devA | Docs only | |

## 2. Canonical contract

- Backend routes/shapes: **`docs/api.md`** (in `origin/backend`). That is the contract the frontend must match.
- Frontend live client: `frontend/src/lib/api/http.ts` (routes), `contract.ts` (interface), `types.ts` (shapes),
  `frontend/src/components/app/realtime-bridge.tsx` (events).
- Everything in the app goes through the `Api` interface, so only `http.ts` (+ the shapes it assumes) needs to change.

## 3. Frontend `live` client vs `docs/api.md` — must-fix mismatches

| Frontend calls | Backend actually provides | Fix |
|---|---|---|
| `POST /realtime/token` | `GET /auth/ws-token` | rewire client (method + path) |
| `POST /users/invite` | `POST /users` → `{ user, temporaryPassword }` | see §4 (invite flow) |
| `POST /auth/invites/:token/accept` | — none — | see §4 |
| `GET /workspace/settings` · `PATCH /workspace/settings` | `GET /workspace` · `PATCH /workspace` (settings nested in the workspace object) | adapt client |
| `GET /contacts/tags` | — none — (tags are a filter) | adapt client or add endpoint |
| `POST /payments` | `POST /opportunities/:id/payment-requests` | adapt client |
| `POST /calendar/google/disconnect` | `DELETE /calendar/google` | adapt client |
| pagination `page` / `pageSize` / `q` / `sort` / `filters: []` | keyset `cursor` / `limit` / `q` / `filters: { logic, criteria[] }` | rewrite client paging (`page()` helper) |
| realtime event `integration:updated` | `integration:status` | align event names |
| `GET /dashboard/prefs` | `PUT /dashboard/prefs` (reads come from `GET /dashboard`) | adapt client |
| realtime payloads `{ type, lead, message, payment, user, conversationId }` | see `src/realtime/realtime.gateway.ts` | verify each payload shape |

Working as-is (no change needed): `/auth/login`, `/auth/signup`, `/auth/me`, `/auth/logout`, `/workspace`,
`/users`, `/roles` (GET/POST), `/companies`, `/contacts`, `/opportunities`, `/leads`, `/leads/recovery`,
`/conversations`, `/integrations`, `/alerts`, `/alerts/telegram/link`, `/calendar/google/connect`, `/dashboard`,
`/pipelines`, `/custom-fields`, `/saved-lists`, `/appointments`.

## 4. Backend gaps the frontend expects (only real functional gap)

1. **Invite flow** — the frontend has a public `/invite/[token]` page and `acceptInvite()`; the backend only
   creates a user and returns a temporary password (`POST /users`). Either:
   - (a) implement `POST /users/invite` → token + `POST /auth/invites/:token/accept` in the backend, or
   - (b) adapt the frontend to the temp-password flow.
   (a) is the better UX and matches F1.1/F1.2 ("the Owner can invite users").
2. `/contacts/tags` — minor; either add it or read tags from the contacts list in the client.

## 5. Ops / deploy (PLAN.md "Teammate 2" deliverables)

- **Railway**: api + Postgres + Redis from `backend/Dockerfile`; env `DATABASE_URL`, `REDIS_URL`, `PUBLIC_URL`,
  `APP_URL`, `CORS_ORIGINS`, `APP_ENCRYPTION_KEY`, `SESSION_IDLE_HOURS`, `SESSION_ABSOLUTE_DAYS`, plus
  `GOOGLE_CLIENT_ID/SECRET` and `TELEGRAM_BOT_TOKEN/WEBHOOK_SECRET` once accounts exist.
- **Vercel**: frontend with `NEXT_PUBLIC_API_MODE=live` and the API base URL.
- **Providers** (need real sandbox accounts):
  - Twilio WhatsApp sandbox: have a phone join, then paste the webhook URLs from `GET /integrations`.
  - Stripe test mode: secret key + webhook signing secret; register `POST {PUBLIC_URL}/webhooks/stripe/{workspaceId}`.
  - Google OAuth web client: authorized redirect `PUBLIC_URL/calendar/google/callback`.
  - Telegram bot: `TELEGRAM_BOT_TOKEN`, then `setWebhook` → `PUBLIC_URL/webhooks/telegram` with the secret token.
- Seed the deployed workspace; verify the public lead form and inbound webhooks reach the public URL.
- `docs/demo-script.md` + fallback videos.

## 6. Verification assets

- `backend/scripts/smoke/*.mjs` — five standalone HTTP suites (crm, leads, dashboard, workspaces, realtime),
  151 assertions total, written against the `feat/backend-scaffold` contract. Port the paths/shapes to
  `docs/api.md`, point at a running API, and use them as the regression suite after integration.
  Credentials in those scripts: `owner@demo.test` / `Password123!` (devB seed). devA's seed uses `Demo1234!`.

## 7. Suggested sequence

1. Adapt `http.ts`/`contract.ts`/`types.ts` + `realtime-bridge` to `docs/api.md` (the bulk).
2. Resolve §4 (invite flow) and re-check the two providers that need a public URL.
3. Run backend + frontend locally in `live` mode; fix until every screen shows real data.
4. Deploy (§5), seed, register webhooks, verify inbound + outbound.
5. Re-run the smoke suites against the deployed URL.

## 8. Notes

- Seed logins differ per branch: devA `owner@demo.test` / `Demo1234!`; devB branch `owner@demo.test` / `Password123!`.
- The uncommitted `backend/src/integrations/*` scaffold on `feat/backend-scaffold` is a partial, superseded copy — ignore it.
