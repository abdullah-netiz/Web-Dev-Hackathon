# PLAN.md — 6 hours, 3 people, our own platform

Repository: https://github.com/abdullah-netiz/Web-Dev-Hackathon
Requirements: `docs/problem-statement.md` · Engineering rules: `AGENTS.md` · Research: `docs/research/`
Reference (inspiration only, not copied): https://github.com/twentyhq/twenty — see §10 for the patterns we borrow.

## 1. Context

The problem statement asks for one multi-tenant platform where a company manages its CRM, guarantees every
inbound lead has one accountable owner at every moment, and talks to customers, collects payments and books
appointments through real sandbox integrations, with every action traceable. Judges score the quality
requirements (Q1–Q14) as hard as the features, so every feature below names the NFRs it must satisfy.

We build our own system. **Backend** (`backend/`): one NestJS API that owns all data, rules and integrations.
**Frontend** (`frontend/`): a Next.js app consuming that API and its Socket.IO events. Twenty CRM is used only
as a design reference for how a production CRM backend structures workspaces, metadata-driven custom fields,
timeline events and queue-based automation.

## 2. Stack (details and NFR rationale in `AGENTS.md §2`)

Backend: NestJS 11 on Fastify, Prisma 6 + PostgreSQL 16, BullMQ 5 on Redis 7, Socket.IO 4, Zod 4, argon2id
sessions, Pino. Frontend: Next.js 16, React 19, Tailwind 4, shadcn/ui (Radix), TanStack Query 5 + Table v8,
react-hook-form + Zod. Hosting: Railway (api, Postgres, Redis), Vercel (web). Alerts: Telegram bot.

## 3. Architecture

```
Browser (Next.js on Vercel) ── HTTPS JSON, Bearer session token ──► backend API (Railway, NestJS/Fastify)
                            ── WSS socket.io (short-lived ws token) ──►   ├─ auth · workspaces · crm · leads · audit · metrics · realtime
                                                                          ├─ integrations: connections, events, webhooks
                                                                          │     providers: twilio | stripe | google | telegram (behind interfaces)
                                                                          └─ jobs (BullMQ): escalation · integrations · alerts · housekeeping
                                                                      PostgreSQL ◄─ Prisma      Redis ◄─ BullMQ (noeviction, AOF)
Webhooks in: /webhooks/twilio, /webhooks/twilio/status, /webhooks/stripe, /webhooks/telegram · OAuth: /calendar/google/callback
Public: /f/<workspace-slug> lead form
```

The BullMQ workers run inside the API process for the hackathon; the code is process-independent.

## 4. Data model (Prisma, `backend/prisma/schema.prisma`)

All tenant tables carry `workspaceId` and composite indexes starting with it; editable records carry `version`.

| Table | Purpose / integrity rule |
|---|---|
| `workspaces`, `workspace_settings` | tenant + lead-engine settings in seconds (ack window, levels, idle, max open leads, round-robin cursor) |
| `users` (baseLevel OWNER/ADMIN/USER, roleId, availability, telegramChatId), `sessions`, `roles` (permissions[]) | F1; Owner protected from Admin; sessions expire and revoke (Q1) |
| `companies`, `contacts` (phone unique per workspace, optedOut, tags, custom JSONB) | F2.1, I1.5; GIN on custom |
| `pipelines`, `pipeline_stages` (order, isWon/isLost, requiredFieldKeys) | F2.5 safe delete needs `moveToStageId` |
| `custom_field_definitions` (entity, key, type, options, pipelineId, isArchived) | F2.2, F2.3; archive not delete |
| `opportunities` (value, currency, stageId RESTRICT, custom JSONB, paymentStatus) | F1.4 masking in serializer |
| `leads`, `lead_assignments` (partial unique: one PENDING per lead; jobId) | F3; F3.8 |
| `activities` | F2.7 timeline, also marks "Acknowledged by action" |
| `audit_events` (append-only, no update/delete code path; DB `REVOKE`) | F4 |
| `saved_lists`, `dashboard_prefs` | F2.6, F5.5 |
| `integration_connections` (encrypted secrets, status, lastOkAt, lastError), `integration_events` (unique provider+externalEventId) | I5 |
| `conversations`, `messages` (providerSid unique, monotonic status) | I1 |
| `payments` (stripeSessionId unique) | I2, Section 7 revenue |
| `appointments`, `calendar_tokens` (per user, encrypted refresh token) | I3 |
| `alert_deliveries` (unique assignment+channel), `member_links` (Telegram link codes) | I4 |

## 5. Lead engine (F3)

```
capture(source) → lead NEW → assign(): candidates = users AVAILABLE with openLeads < limit, ordered by lastAssignedAt
  (transaction locks the workspace cursor row) → assignment PENDING (dueAt = now + ackWindowSec) → BullMQ delayed job
  esc-<leadId>-<assignmentId> → activity + audit + socket lead:assigned
ack()/any recorded action → assignment ACKNOWLEDGED, lead ACKNOWLEDGED, timeToFirstResponse, remove job, audit, socket
job fires → tx: re-read assignment; if still PENDING → EXPIRED; level+1 target (next available → backup → manager);
  new PENDING assignment + job; audit; socket lead:escalated; Telegram alert via alerts queue
availability → ON_LEAVE/OFFLINE → reassign that user's PENDING assignments immediately (F3.6)
recovery sweep every 30 s → recoveryReason OVERDUE | ESCALATED_TWICE | IDLE | NONE (Section 7)
startup reconciliation → every PENDING assignment with dueAt < now and no job → enqueue delay 0 (Q5)
```

Pure decision logic lives in `backend/src/leads/assignment.logic.ts` with unit tests; everything else calls it.

## 6. Team split

| Person | Owns |
|---|---|
| **Backend (Claude)** | `backend/`: data model, auth/RBAC, CRM API, lead engine, audit, metrics, Socket.IO, all four integrations, intake form, API reference (`docs/api.md`), seed data, tests |
| **Teammate 1 — Frontend** | `frontend/`: Next.js app against `docs/api.md`: auth, settings (users, roles matrix, pipeline, fields, assignment, integrations, audit), contacts/companies, opportunities board + list, leads inbox with countdown, recovery queue, conversations, payments, booking dialog, dashboard; responsive + a11y + loading/error states |
| **Teammate 2 — Ops & integrations setup** | Railway (api, Postgres, Redis) + Vercel; provider accounts (Twilio sandbox, Stripe test, Google OAuth client, Telegram bot) and webhook registration; seed demo workspace; `docs/demo-script.md`; README; fallback videos; also helps on frontend screens once ops is done |

Hand-offs: backend publishes `docs/api.md` + Zod schemas in `backend/src/**/dto` first; frontend builds against mocks until endpoints land. Ops gives backend the public URL and provider credentials by minute 60.

## 7. Timeline

| Window | Backend | Frontend | Ops |
|---|---|---|---|
| 0:00–0:45 | scaffold, Prisma schema, auth + sessions + permission guard, `docs/api.md` v1 | Next.js scaffold, shadcn (Radix), Query provider, shell, auth pages against API doc | Railway + Vercel projects, Postgres/Redis, domain or Railway URL, provider accounts |
| 0:45–2:15 | CRM module (companies, contacts, custom fields, pipeline, opportunities, saved lists, activities), audit, Socket.IO | settings screens, contacts list/detail with custom-field renderer, opportunities board | deploy API from `backend/Dockerfile`, env vars, webhook URLs registered |
| 2:15–3:45 | lead engine + recovery + reconciliation; Twilio, Telegram | leads inbox + countdown + acknowledge, recovery queue, conversations | seed workspace with 300 contacts / 60 opportunities; real phone joins Twilio sandbox |
| 3:45–4:45 | Stripe, Google Calendar, metrics/dashboard endpoints | dashboard with drill-down, payment request, booking dialog, integrations page | end-to-end run on cloud; fix list |
| 4:45–5:30 | fixes, tests green, restart-survival check | 375 px pass, keyboard pass, toasts everywhere | demo script rehearsal, fallback videos |
| 5:30–6:00 | buffer | buffer | buffer |

**Cut lines** (drop in order if behind): F2.3 second pipeline → I3.6 reschedule (keep cancel) → I3.4 conflict check → F2.6 saved lists (URL filters) → I2.5 refund UI → F5.5 prefs (localStorage) → CSV export.
**Never cut:** isolation, server-side permissions + value masking, ack timer + escalation + Telegram, restart survival, Stripe webhook-driven status, audit log.

## 8. Requirement → NFR traceability

| Req | Complements | Mechanism |
|---|---|---|
| F1.1 | Q1, Q6, Q10 | argon2id; `sessions` with idle + absolute expiry, revoke on logout; Bearer token + optional cookie; login throttle 5/min per email+IP |
| F1.2 | Q2, F4.1 | `baseLevel` checks in guard (Admin cannot modify Owner); role changes audited with before/after |
| F1.3 | Q2, Q12 | `roles.permissions[]` from one constant list exported to the frontend via `GET /meta/permissions` |
| F1.4 | Q2, Q12 | response serializer strips `value` for callers without `crm.view_values` in lists, detail, exports |
| F1.5 | Q2, Q3 | `AuthGuard` → `PermissionGuard` → Zod validation on every handler; guard tests |
| F1.6 | Q2, Q4 | every repository call scoped by `workspaceId` from the session; foreign ids → 404 |
| F2.1 | Q4, Q9 | FKs `Restrict`; paginated related lists |
| F2.2 | Q3, Q4, Q9 | definitions table → Zod schema built per request; JSONB values with GIN index; archive on delete |
| F2.3 | Q12 | `pipelineId` on definitions; API returns the field set for the opportunity's pipeline |
| F2.4 | Q3, Q10 | stage move validates `requiredFieldKeys`; 422 lists missing fields |
| F2.5 | Q4, F4.1 | reorder in one tx; delete requires `moveToStageId`; audited |
| F2.6 | Q9, Q12 | filters JSON compiled to Prisma `where` at read time |
| F2.7 | Q9, Q12 | `activities` written in the same tx as the change |
| F2.8 | Q9, Q11, Q12 | `GET /contacts/:id/overview` composes all related records; socket invalidation |
| F3.1–F3.9 | Q3, Q5, Q11, I4 | see §5 |
| F4.1–F4.3 | Q2, Q4, Q6 | same-tx writes; `audit.view` permission; no update/delete route; DB `REVOKE` |
| F5.1–F5.5 | Q9, Q11, Q12 | `metrics.service` single source implementing Section 7; drill-down filters reused by list endpoints; role scope; prefs table |
| I1–I5 | Q3, Q5, Q10, Q13, Q14 | raw-body signature checks, unique external event ids, status callbacks monotonic, queues with retries, encrypted per-workspace credentials, provider interfaces, health + limits text |

## 9. Verification and demo script

1. Fresh clone → `docker compose up -d` → `pnpm --dir backend db:migrate && db:seed && dev` (Q13).
2. Two workspaces: curl a workspace A contact id with workspace B's token → 404 (F1.6).
3. User without `crm.view_values`: value masked in list, detail, export; `PATCH /roles/:id` as User → 403 (F1.4, F1.5).
4. Ack window 20 s: public form → lead live for everyone → expiry → next user → Telegram → second expiry → manager → recovery queue with reason (F3, I4, Q11).
5. Restart API during a 60 s window → exactly one escalation afterwards (Q5).
6. WhatsApp from a phone → conversation + lead; reply → delivered; webhook replay → no duplicate; forged signature → 403 + event (I1).
7. Payment link → `4242…` → PAID without refresh; `stripe trigger checkout.session.expired` → EXPIRED; dashboard updates (I2).
8. Google connect → busy-slot warning → free slot → event in Google Calendar → cancel → removed + activity (I3).
9. Audit filtered by escalation; `DELETE /audit/:id` → 404 (F4).
10. 375 px walkthrough, keyboard-only dialog, Lighthouse a11y, 500-contact paginated list, search stays responsive.

## 10. What we borrow from Twenty (patterns, not code)

- Workspace as the tenant boundary on every table and every query; API keys scoped to a workspace.
- Metadata-driven custom fields: a definitions table plus JSON values, validated server-side from the definitions.
- Timeline activities written alongside every record change, with actor and before/after properties.
- Queue-backed delayed steps (their workflow `DELAY` is a BullMQ job that resumes the run) → our ack timers.
- Outbound webhooks signed with HMAC over `timestamp:body` → our Twilio/Stripe verification discipline.
- Roles as permission sets with object-level and field-level permissions → our `permissions[]` plus value masking.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Provider setup eats hour 1 | Ops does all accounts in the first 30 min |
| Frontend blocked on API | `docs/api.md` + Zod schemas first; stable response envelope `{ data, meta }` / `{ code, message, action }` |
| Timer bugs under pressure | logic isolated in `assignment.logic.ts` with tests; processors re-check state |
| Google refresh tokens expire after 7 days in Testing | connect on demo day; reconnect state built in |
| Twilio sandbox limits (join phrase, 3-day session, 1 msg / 3 s, 24 h window) | limits text in UI; queue limiter |
