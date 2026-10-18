# AGENTS.md — Unified Business Management Platform

Instructions for every human and AI coding agent in this repository. Read fully before touching code.
`PLAN.md` is the 6-hour build plan with owners. `docs/problem-statement.md` is the authoritative
requirement list (IDs `F1.1 … F5.5`, `I1.1 … I5.8`, `Q1 … Q14`). `docs/api.md` is the API contract the
frontend builds against. `docs/research/` holds the official-docs research behind the technical choices.
Twenty CRM (https://github.com/twentyhq/twenty) is a **reference for patterns only**; we do not copy its code.

## 1. What we are building

A multi-tenant web platform for 5–30 person service companies:

- **Accounts & RBAC** — workspaces, Owner/Admin/User base levels, configurable permissions (F1).
- **Customizable CRM** — contacts, companies, opportunities, runtime custom fields, pipelines with stages (F2).
- **Lead engine** — capture → round-robin assignment → acknowledgement window → escalation chain → recovery queue (F3). *The core: a lead must never be without an accountable owner.*
- **Audit history** — append-only record of important actions (F4).
- **Dashboard** — live, role-aware, drill-down figures using Section 7 definitions (F5).
- **Real integrations in sandbox/test mode** — Twilio WhatsApp (I1), Lemon Squeezy payments (I2), Google Calendar (I3), Slack alerts (I4), shared rules (I5). Every provider must work from Pakistan: Telegram is blocked there and Stripe does not onboard Pakistani accounts, so neither is used.

Out of scope: accounting, payroll, ad analytics, report builder, training, marketing site, platform billing.

## 2. Tech stack (locked)

| Layer | Choice | Why it serves the NFRs |
|---|---|---|
| Backend | NestJS **11** on the **Fastify** adapter, TypeScript | Modules/guards/pipes enforce layering (Q14); `rawBody: true` for webhook signatures (I1.2, I2.3). Nest 12 is days old; not worth the risk |
| ORM / DB | Prisma **6** + PostgreSQL 16 | JSONB + GIN for custom fields (F2.2); FK rules and `version` columns for integrity (Q4); real persistence (Q6) |
| Jobs | BullMQ **5** on Redis 7 (`maxmemory-policy noeviction`, AOF) | Delayed jobs survive restarts (Q5); deterministic `jobId` prevents double escalation (F3.8); retries with backoff (I5.5) |
| Real-time | Socket.IO 4 (`@nestjs/platform-socket.io`) | Rooms `ws:<workspaceId>` / `user:<userId>` push leads, escalations, messages (Q11) |
| Auth | `sessions` table + `argon2id` + `@nestjs/throttler` | Revocable, expiring sessions; brute-force protection (Q1) |
| Validation | Zod 4 via our `ZodValidationPipe` | Every body/query/param validated server-side (Q3); schemas shared with the frontend through `docs/api.md` |
| Logging | Pino (`nestjs-pino`) with `redact` | Cheap structured logs, secrets redacted (Q13) |
| Frontend | Next.js **16** App Router, React 19, Tailwind 4, shadcn/ui (**Radix**: `npx shadcn init -b radix`), TanStack Query 5, TanStack Table **v8**, react-hook-form + Zod | Responsive utilities (Q7), WAI-ARIA components (Q8), paginated/non-blocking lists (Q9), `isPending/isError` states (Q10) |
| Hosting | Railway (api + Postgres + Redis), Vercel (web) | Public HTTPS for webhooks |

Versions verified on 2026-10-18 (`docs/research/*`). If a package resolves to a different major, check its migration guide first.

## 3. Repository layout

```
backend/                 NestJS API (this is where all data, rules and integrations live)
  prisma/                schema.prisma, migrations (incl. hand-written SQL for partial/GIN indexes), seed.ts
  src/<feature>/         controller · service · repository · dto · processor (see §5)
  public/                intake form page
frontend/                Next.js app (owned by the frontend teammate)
infra/                   docker-compose.yml, railway notes
docs/                    problem-statement.md, api.md, demo-script.md, research/
AGENTS.md, PLAN.md, README.md
```

## 4. Non-negotiable rules

1. **Every query is workspace-scoped.** Repositories take `workspaceId` from the authenticated session, never from the URL or body. A lookup by id without `workspaceId` is a bug; foreign ids return 404 (F1.6, Q2).
2. **Permissions are enforced by a guard on the server.** `@RequirePermission('crm.edit')` on handlers; `PermissionGuard` resolves the user's role permissions and base level. Hiding a button is not enforcement (F1.5). `Opportunity.value` is removed by the serializer when the caller lacks `crm.view_values` (F1.4).
3. **Important actions write an audit event in the same transaction**: assignment, ack, escalation, reassignment, role/permission changes, field/pipeline config changes, integration changes, deletions. `audit_events` has no update/delete route or repository method, and the DB role has no UPDATE/DELETE grant (F4).
4. **Timers live in BullMQ, never `setTimeout`/`@nestjs/schedule`.** Ack windows are delayed jobs `esc-<leadId>-<assignmentId>`; the processor re-reads the assignment in a transaction and escalates only if it is still `PENDING`. Startup reconciliation re-enqueues overdue assignments (Q5, F3.8).
5. **Webhooks: verify on the raw body, record, 2xx, then process in a queue.** `integration_events (provider, externalEventId)` is unique; duplicates are no-ops (I1.8, I2.4, I5.4). Webhook routes are `@Public()` and `@SkipThrottle()`.
6. **Secrets never reach the browser or git.** Provider credentials are encrypted per workspace (`APP_ENCRYPTION_KEY`), returned masked, redacted in logs (I5.3, Q13). `.env` is ignored; `.env.example` is complete.
7. **Optimistic concurrency.** Editable records carry `version`; updates use `updateMany` with `{ id, workspaceId, version }` and return 409 on zero rows (Q4).
8. **Deletes are safe.** Stage deletion needs `moveToStageId`; field deletion archives; user deactivation reassigns pending leads first; FKs `Restrict` by default, `SetNull` for optional owners, `Cascade` only for pure children (F2.5, Q4).
9. **One definition per metric.** `backend/src/metrics/definitions.ts` implements Section 7; dashboard, lists and exports call it (F5.2, Q12).
10. **Integration failures are isolated and visible.** Providers sit behind interfaces; calls run in queues with retries; failures set `FAILED` + reason on the record and `lastError` on the connection, never break unrelated flows (I1.7, I4.4, I5.5, I5.8).
11. **Every response is predictable.** Success: `{ data, meta? }`. Error: `{ code, message, action?, details? }` with a message that says what went wrong and what to do (Q10).
12. **Frontend quality bar.** Radix-based components, labelled inputs, `aria-label` on icon buttons, state never by colour alone, contrast ≥ 4.5:1 (Q8); every screen works at 375 px (Q7); every mutation shows loading, success and failure (Q10).

## 5. Backend architecture (Q14)

```
backend/src/
  common/        env (Zod), encryption, prisma, validation pipe, exception filter, decorators, serializer
  auth/          signup/login/logout/sessions, AuthGuard, PermissionGuard, throttling
  workspaces/    workspace settings, users, roles, availability
  crm/           companies, contacts, opportunities, pipelines/stages, custom fields, saved lists, activities
  leads/         intake, assignment, acknowledgement, escalation processor, recovery sweep, reconciliation
  audit/         append-only audit writer + read endpoint
  metrics/       Section 7 definitions, dashboard endpoint
  realtime/      Socket.IO gateway (ws token, rooms, emit helpers)
  integrations/  connections, integration_events, webhooks controller, providers/{twilio,lemonsqueezy,google-calendar,slack}
  messaging/ payments/ calendar/ alerts/   domain services mapping provider events ⇄ records
  jobs/          BullMQ root config, queue names, processors registration
```

Controllers validate and call services; services hold rules and transactions and call repositories; repositories hold Prisma only; provider SDK code lives only under `integrations/providers`.

## 6. Performance rules (official docs; details in `docs/research/`)

- Fastify adapter; `trustProxy`; guards → pipes → handler; one global exception filter. https://docs.nestjs.com/techniques/performance
- Login throttle 5/min keyed by email+IP, generic error; argon2id `memoryCost 19456, timeCost 2, parallelism 1`. https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- BullMQ: `attempts 5`, exponential backoff, `removeOnComplete/removeOnFail`, `UnrecoverableError` on provider 4xx; job ids without `:`; Redis `noeviction`. https://docs.bullmq.io/guide/going-to-production
- Postgres: composite indexes start with `workspaceId`; GIN `jsonb_path_ops` on `custom`; partial unique index on pending assignments; `pg_trgm` for search; keyset pagination. https://www.postgresql.org/docs/current/indexes-partial.html
- Prisma: `select` only needed columns in lists; `updateMany` + `version` for OCC; interactive transactions only around the assignment claim. https://www.prisma.io/docs/orm/prisma-client/queries/transactions
- Socket.IO: authenticate in `io.use()`, rooms per workspace/user, clients `transports: ['websocket']`. https://socket.io/docs/v4/rooms/
- Frontend: Server Components for shells, `useDeferredValue` for search, TanStack Query keys include filters, `keepPreviousData`, invalidate on socket events, virtualize > 200 rows. https://nextjs.org/docs/app/guides/production-checklist

## 7. Commands

```bash
cd backend && pnpm install && cp .env.example .env
docker compose -f ../infra/docker-compose.yml up -d     # postgres + redis
pnpm prisma:migrate && pnpm seed                        # schema + demo workspace
pnpm dev                                                # API on :4000, docs at docs/api.md
pnpm test && pnpm typecheck
```

## 8. Working agreements

- Trunk-based; short branches `feat/<area>-<thing>`; squash merge; never force-push `main`.
- Commits cite requirement IDs: `feat(leads): escalation chain (F3.5, F3.8, Q5)`.
- Contract first: new endpoint = Zod schema in `backend/src/<module>/dto` **and** an entry in `docs/api.md` in the same PR.
- Definition of done: acceptance criterion passes on the deployed URL with seed data; audit written where §4.3 requires; failure path visible in UI.
- Ask before: destructive data changes, breaking schema changes, dependencies over 100 kB, changing a shared DTO someone else uses.
