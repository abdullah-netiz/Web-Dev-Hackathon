# AGENTS.md — Unified Business Management Platform (built on Twenty CRM)

Instructions for every human and AI coding agent in this repository. Read fully before touching code.
`PLAN.md` is the 6-hour build plan with owners. `docs/problem-statement.md` is the authoritative
requirement list (IDs `F1.1 … F5.5`, `I1.1 … I5.8`, `Q1 … Q14`). `docs/research/` holds the
official-docs research behind the technical choices.

## 1. Strategy in one paragraph

We do **not** build a CRM from scratch. We fork [Twenty](https://github.com/twentyhq/twenty)
(open-source CRM, AGPL-3.0: NestJS 11 + TypeORM + PostgreSQL + Redis + BullMQ backend, React 19 +
Vite frontend) and use its backend **as is** for accounts, workspaces, roles, object/field/row
permissions, custom objects and fields, pipelines (kanban on a select field), views and saved
filters, timeline activities, dashboards, workflows, REST/GraphQL API, API keys and outbound
webhooks. We add what the problem statement needs and Twenty lacks in a **separate NestJS service,
`services/lead-engine`**, which talks to Twenty through its REST API and webhooks: lead intake and
the assignment / acknowledgement / escalation / recovery engine, Twilio WhatsApp, Stripe payments,
Google Calendar booking, Telegram alerts, integration health and the audit trail. The frontend is
Twenty's, rebranded (name, logo, colours, favicon, footer, emails) in our fork.

Out of scope: accounting, payroll, ad analytics, report builder, training, marketing site,
billing for the platform itself (Twenty's own billing module stays disabled: `IS_BILLING_ENABLED=false`).

## 2. Repository layout

```
twenty/                      git submodule → our fork of twentyhq/twenty (branch `brand`)
                             only branding files and tiny UI tweaks change here (see §6)
services/lead-engine/        our NestJS 11 service (Fastify, Prisma 6, BullMQ, Socket.IO not needed)
twenty-app/                  data-model definition: objects, fields, roles, views, workflows, dashboard
                             (applied with scripts/apply-data-model.ts through Twenty's metadata REST API)
infra/                       docker-compose.yml (local), railway/ (deploy), .env.example files
docs/                        problem-statement.md, demo-script.md, research/
AGENTS.md, PLAN.md, README.md
```

Twenty's own agent rules live in `twenty/CLAUDE.md` and apply to anything inside `twenty/`
(Linaria styling, Lingui strings, named exports, no AI attribution in commits, do not commit
translation catalogs). Our rules below apply to everything outside `twenty/`.

## 3. Tech stack (locked)

| Part | Choice | Why it serves the NFRs |
|---|---|---|
| CRM core | Twenty (fork, pinned to upstream commit `289976e`, 17 Oct 2026) | Auth, workspaces, roles with permission flags + object + field + row-level permissions (F1, Q1, Q2), custom objects/fields (F2.2, F2.3), kanban + views + saved filters (F2.5, F2.6), timeline activities (F2.7), dashboards (F5), live record updates via GraphQL subscriptions (Q11), CSV export respecting field permissions (F1.4) |
| Twenty runtime | Official image `twentycrm/twenty` for `server` and `worker`, PostgreSQL 16, Redis 7 | Backend unchanged = zero backend build risk; real database (Q6) |
| Twenty frontend | Our fork of `packages/twenty-front` built with Vite, served as a static site with `REACT_APP_SERVER_BASE_URL` pointing at the server | Rebrand without rebuilding the server image |
| lead-engine | NestJS 11 on Fastify, Prisma 6 + its own Postgres schema `lead_engine`, BullMQ 5 on the shared Redis, Zod 4, Pino | Durable timers (Q5), idempotent webhooks (I1.8, I2.4), retries (I5.5), clean layering (Q14) — see `docs/research/backend-performance-official-docs.md` |
| Integration SDKs | `twilio` 6, `stripe` 23, `googleapis` 186, Telegram Bot API via fetch | Real sandbox providers (I1–I4) |
| Hosting | Railway: `twenty-server`, `twenty-worker`, `lead-engine`, `front` (static), Postgres, Redis; one custom domain with wildcard DNS | Public HTTPS for webhooks; wildcard subdomain per workspace for Twenty multi-workspace mode (F1.1, F1.6) |

Versions were verified on 2026-10-18 (`docs/research/*`). Do not upgrade Twenty mid-hackathon.

## 4. Non-negotiable rules

1. **Twenty is the system of record.** Every customer-facing fact (lead, assignment, message, payment, appointment, audit event) is a Twenty record so the record page shows it (F2.8) and the same figure appears everywhere (Q12). `lead-engine` keeps only operational state (job bookkeeping, provider secrets, webhook idempotency keys, provider event mirror) in its own schema.
2. **One Twenty workspace = one tenant.** `lead-engine` stores, per workspace: Twenty workspace id, Twenty API key, provider credentials (encrypted with `APP_ENCRYPTION_KEY`), settings. Every job and every request carries `workspaceId`; the Twenty client is instantiated per workspace with that workspace's key. Never share a key across workspaces (I5.2, F1.6).
3. **Permissions are Twenty's.** Who can see leads, opportunity amounts, the audit object, integration settings is configured as Twenty roles (object permissions, field permissions, row-level predicates). `lead-engine` endpoints called from the browser are limited to: the public intake form, OAuth callbacks, provider webhooks, and the Telegram link redirect. Everything else happens through Twenty's UI, actions and workflows (F1.5).
4. **Timers live in BullMQ, never in `setTimeout`.** Ack windows are delayed jobs `esc-<leadId>-<assignmentId>`; the processor re-reads the lead from Twenty and escalates only if `status == ASSIGNED && acknowledgedAt == null && assignmentId` unchanged. Startup runs a reconciliation sweep over `ASSIGNED` leads whose `dueAt < now` (F3.4, F3.5, F3.8, Q5).
5. **Webhooks: verify, record, 2xx, then process.** Twilio (`X-Twilio-Signature` on the public URL), Stripe (`constructEvent` on `req.rawBody`), Telegram (`X-Telegram-Bot-Api-Secret-Token`), Twenty (HMAC secret). Insert into `integration_events (provider, external_event_id UNIQUE)` first; a conflict means duplicate → 200 and stop (I1.2, I1.8, I2.3, I2.4, I5.4).
6. **Audit in the same operation.** Every assignment, ack, escalation, reassignment, integration connection change, alert, deletion observed via Twenty webhook `*.deleted` writes an `AuditEvent` record in Twenty (actor or `system`, before/after). The `AuditEvent` object's role permissions are read-only for everyone except `lead-engine`'s API key; no code path updates or deletes it (F4.1–F4.3). Known gap: Twenty role/permission edits are not exposed through webhooks; see PLAN §9.
7. **Secrets never reach the browser or git.** Provider keys are entered through the Integrations settings page (a Twenty custom object `IntegrationConnection` with a masked display field) and pushed to `lead-engine` via webhook, or entered in `lead-engine`'s own settings endpoint protected by the workspace API key. Logged through Pino with `redact` (I5.3, Q13).
8. **Idempotent writes to Twenty.** Use deterministic external ids (`providerSid`, `stripeSessionId`, `telegramMessageId`) on records and `upsert`-style logic (find by external id, then create or update) so a retried job never duplicates a Message or Payment.
9. **Integration failures are isolated.** Provider calls run in the `integrations` queue with retries and backoff; a failed send leaves a `Message` with `status=FAILED` and `errorMessage`, bumps `IntegrationConnection.lastError`, and never blocks assignment or escalation (I1.7, I4.4, I5.5, I5.8).
10. **Metric definitions are code, in one place.** `services/lead-engine/src/metrics/definitions.ts` implements Section 7 of the problem statement (time to first response, recovery reasons, available employee, collected vs projected revenue) and is the only place that computes them; computed values are written to Lead/Payment fields that dashboard widgets aggregate (F5.2, Q12).
11. **Observable in seconds.** Ack window, idle period, max open leads and escalation levels are workspace settings in seconds, editable from the Settings object in Twenty, read by `lead-engine` on every assignment.
12. **Frontend changes stay branding-sized.** In `twenty/` we touch only the files in §6 unless `PLAN.md` says otherwise. No feature work in the Twenty frontend; features are custom objects, views, dashboards and workflows.

## 5. lead-engine architecture (Q14 layering)

```
services/lead-engine/src/
  common/            config (Zod-validated env), prisma, encryption, logger, exception filter
  twenty/            TwentyClient (REST: find/create/update/upsert records, metadata), webhook verifier
  workspaces/        workspace connections (api key, settings, provider credentials), Telegram chat links
  leads/             intake (public form, manual via Twenty, inbound message), assignment, ack, escalation,
                     recovery marking, reconciliation — controller / service / repository / processor
  integrations/      integration_events, health, retry policy; providers/{twilio,stripe,google,telegram}
                     behind MessagingProvider / PaymentProvider / CalendarProvider / AlertProvider interfaces
  messaging/ payments/ calendar/ alerts/   domain services that map provider events ⇄ Twenty records
  audit/             writes AuditEvent records
  metrics/           Section 7 definitions, periodic recomputation job
  jobs/              BullMQ queues: escalation, integrations, alerts, metrics
```

Flow: Twenty webhook (`lead.created|updated`, `person.updated`, `*.deleted`, `integrationConnection.updated`)
→ `POST /twenty/webhooks` → verify → `integration_events` → queue → domain service → Twenty REST write
→ Twenty publishes live updates to the browser.

## 6. Branding touch-points in `twenty/` (Dev C)

Files verified in the pinned commit:

- `packages/twenty-front/index.html` — `<title>`, `og:title`, `twitter:title`, favicon links, social card.
- `packages/twenty-front/public/images/icons/{android,ios,windows11}` and `public/manifest.json` — icons and app name.
- `packages/twenty-front/src/modules/auth/components/Logo.tsx` — sign-in logo.
- `packages/twenty-front/src/modules/auth/sign-in-up/components/FooterNote.tsx` and `src/modules/auth/utils/getTwentyWebsiteUrl.ts` — footer links.
- `packages/twenty-front/src/modules/onboarding/components/OnboardingPulsingLogo.tsx`.
- `packages/twenty-ui/src/theme/theme-light.css`, `theme-dark.css` — colour tokens (change accent/primary only; keep contrast ≥ 4.5:1, Q8).
- `packages/twenty-ui/src/icon/components/IconTwentyStar*.tsx` — product mark used in menus.
- `packages/twenty-emails/` — email templates header/footer text.
- Remaining `Twenty` strings: `grep -rn "Twenty" packages/twenty-front/src/modules --include=*.tsx | grep -v "__tests__\|stories"` (59 files, most are variable names; change only user-visible `<Trans>` text).

Build and serve: `npx nx build twenty-shared && npx nx build twenty-front` with `REACT_APP_SERVER_BASE_URL=https://api.<domain>` (`NODE_OPTIONS=--max-old-space-size=8192`); deploy `packages/twenty-front/dist` as the `front` static service. Twenty's server must have `FRONTEND_URL=https://<domain>`.

## 7. Twenty data model we add (`twenty-app/`)

| Object | Key fields | Used for |
|---|---|---|
| `Lead` | person (relation), opportunity (relation), source (`WEB_FORM/MESSAGE/MANUAL`), status (`NEW/ASSIGNED/ACKNOWLEDGED/CLOSED`), assignee (workspaceMember), assignmentId, assignedAt, dueAt, acknowledgedAt, escalationLevel, escalationCount, lastActivityAt, recoveryReason (`NONE/OVERDUE/ESCALATED_TWICE/IDLE`), timeToFirstResponseSec | F3, F5 widgets, Recovery view (`recoveryReason != NONE`) |
| `LeadEvent` | lead, type (`ASSIGNED/ACKNOWLEDGED/ESCALATED/REASSIGNED/RECOVERED`), fromMember, toMember, level, reason, happenedAt | escalation history, "escalations last 24 h" widget |
| `MemberAvailability` | member (workspaceMember), status (`AVAILABLE/BUSY/ON_LEAVE/OFFLINE`), maxOpenLeads, openLeadCount, backupMember, isManager, telegramChatId, lastAssignedAt | F3.2, F3.3, F3.5, I4.3 |
| `Conversation` / `Message` | person, channel, assignee / direction, body, providerSid, status (`QUEUED/SENT/DELIVERED/READ/FAILED`), errorCode, errorMessage, sentAt | I1 |
| `Payment` | opportunity, person, requestedBy, amount, currency, status (`PENDING/PAID/EXPIRED/FAILED/REFUNDED`), stripeSessionId, checkoutUrl, refundedAmount, paidAt | I2, collected revenue |
| `Appointment` | person, opportunity, member, startsAt, endsAt, timeZone, googleEventId, status | I3 |
| `IntegrationConnection` | provider, status, maskedCredential, lastOkAt, lastError, limitsText | I5.1, I5.6 |
| `IntegrationEvent` | provider, direction, type, status, reference, error, happenedAt | I5.4 (mirror of lead-engine table, retention 7 days) |
| `AlertDelivery` | lead, member, channel, status, attempts, lastError | I4.4 |
| `AuditEvent` | actor, action, targetType, targetId, before, after, happenedAt | F4 |
| `LeadSettings` (one record) | ackWindowSec, escalationLevels, levelWindowSec, idleSec, maxOpenLeadsDefault, roundRobinCursor | F3.3–F3.7 configuration |

Roles: `Owner` (Twenty admin role), `Admin` (all settings, no member/role management of Owner), `Manager` (read all leads, reassign, dashboards), `User` (own leads via row-level predicate `assignee = me`, no `Opportunity.amount` via field permission, no `AuditEvent`, no `IntegrationConnection`).

## 8. Commands

```bash
# Twenty locally (official images)
cd infra && docker compose up -d                         # postgres, redis, twenty server + worker
# lead-engine
cd services/lead-engine && pnpm i && cp .env.example .env && pnpm prisma migrate dev && pnpm dev   # :4000
# data model into a workspace (needs TWENTY_API_KEY of that workspace)
pnpm --filter twenty-app apply --workspace demo
# rebranded frontend
cd twenty && yarn && npx nx build twenty-shared && REACT_APP_SERVER_BASE_URL=http://localhost:3000 npx nx start twenty-front
# tests
cd services/lead-engine && pnpm test                   # assignment, escalation, idempotency, signature checks
```

Local webhooks: `stripe listen --forward-to localhost:4000/webhooks/stripe`; `ngrok http 4000` for Twilio/Telegram/Twenty webhooks.

## 9. Working agreements

- Trunk-based in this repo; the `twenty/` submodule tracks branch `brand` of our fork. Never commit directly on upstream `main` of the fork.
- Commits cite requirement IDs: `feat(lead-engine): escalation chain (F3.5, F3.8, Q5)`. Inside `twenty/` follow its commit rules (no AI attribution trailers).
- Contract first: every Twenty object/field used by `lead-engine` is declared once in `twenty-app/objects/*.json` and typed in `services/lead-engine/src/twenty/types.ts`. Changing a field name is a PR touching both.
- Definition of done for a requirement: acceptance criterion from `docs/problem-statement.md` passes on the deployed URL with seed data; audit written where §4.6 requires; failure path visible in UI (Q10).
- Ask before: changing Twenty server env in production, rotating API keys, deleting Twenty objects, touching any `twenty/` file outside §6.
- License: the fork stays AGPL-3.0 with Twenty's notices intact; our repo is public, which satisfies AGPL's network-use clause. Say in the README that the product is built on Twenty.

## 10. Environment variables

`infra/.env.example` (Twenty): `PG_DATABASE_URL`, `REDIS_URL`, `SERVER_URL`, `FRONTEND_URL`, `APP_SECRET`, `ENCRYPTION_KEY`, `IS_MULTIWORKSPACE_ENABLED=true`, `DEFAULT_SUBDOMAIN=app`, `AUTH_PASSWORD_ENABLED=true`, `IS_BILLING_ENABLED=false`, `CALENDAR_PROVIDER_GOOGLE_ENABLED=false` (calendar is handled by lead-engine), `STORAGE_TYPE=local`.

`services/lead-engine/.env.example`: `DATABASE_URL`, `REDIS_URL`, `PUBLIC_URL` (for webhook URLs and Twilio signature), `TWENTY_SERVER_URL`, `TWENTY_WEBHOOK_SECRET`, `APP_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`; per-workspace Twilio and Stripe credentials are stored encrypted in the database, seeded for the demo workspace from `SEED_*` variables.
