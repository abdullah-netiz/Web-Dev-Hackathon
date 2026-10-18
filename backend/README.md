# Backend — Unified Business Management Platform API

NestJS 11 (Fastify) · Prisma 6 + PostgreSQL · BullMQ + Redis · Socket.IO · Zod. The API owns accounts and
permissions, the customizable CRM, the lead assignment/escalation engine, audit history, the dashboard
metrics and the Twilio, Stripe, Google Calendar and Telegram integrations. Rules and architecture:
[`../AGENTS.md`](../AGENTS.md). Endpoint reference for the frontend: [`../docs/api.md`](../docs/api.md).

## Run locally (Q13)

Prerequisites: Node 20+ (tested on 24), pnpm 10, Docker (for Postgres and Redis).

```bash
cd backend
pnpm install
cp .env.example .env            # then set APP_ENCRYPTION_KEY (command in the file) and provider keys as needed
docker compose -f ../infra/docker-compose.yml up -d
pnpm prisma:deploy              # applies prisma/migrations (schema + hand-written indexes)
pnpm seed                       # demo workspace "demo": 6 users, 320 contacts, 60 opportunities
pnpm dev                        # http://localhost:4000  (health: GET /health)
```

Seed logins (password `Demo1234!` unless `SEED_OWNER_PASSWORD` is set):

| Email | Level / role |
|---|---|
| owner@demo.test | Owner |
| admin@demo.test | Admin |
| manager@demo.test | User / Manager (sees all leads, can reassign, company dashboard) |
| sales1@demo.test, sales2@demo.test | User / Sales (sees values) |
| support@demo.test | User / Support (values hidden) |

Public lead form for the demo workspace: `GET /f/demo`.

### Local webhooks

- Stripe: `stripe listen --forward-to localhost:4000/webhooks/stripe/<workspaceId>` and put the printed `whsec_…` into the Stripe integration.
- Twilio and Telegram need a public URL: `ngrok http 4000`, set `PUBLIC_URL` to the ngrok URL, restart, then paste the URLs shown on `GET /integrations` into the Twilio sandbox settings and `setWebhook` for the bot.
- Google: add `${PUBLIC_URL}/calendar/google/callback` as an authorized redirect URI of the OAuth client.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Nest in watch mode |
| `pnpm build` / `pnpm start` | compile to `dist/` and run |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit tests (lead-engine decision logic) |
| `pnpm prisma:migrate` | create a migration in development (needs a database) |
| `pnpm prisma:deploy` | apply migrations (production, CI, first run) |
| `pnpm seed` | idempotent demo data |

## How the lead engine works (F3)

1. A lead is captured (public form, inbound WhatsApp, or manual) and `assign()` runs in a transaction that locks the workspace row (round-robin cursor and settings) and the lead row, picks the next Available employee under their open-lead limit, inserts a `PENDING` assignment and schedules a BullMQ delayed job `esc-<leadId>-<assignmentId>` for the acknowledgement window.
2. Acknowledging (button, note, message, stage change, appointment) marks the assignment `ACKNOWLEDGED` and removes the job.
3. When the job fires it re-reads the assignment; only a still-`PENDING` one escalates: level 1 next available, level 2 the assignee's backup, level 3 a manager. The new owner gets a Socket.IO notification and a Telegram alert.
4. A sweep every 30 s sets `recoveryReason` (`OVERDUE`, `ESCALATED_TWICE`, `IDLE`) from the Section 7 definitions; on startup a reconciliation re-enqueues any window that passed while the server was down.
5. A partial unique index allows one `PENDING` assignment per lead, so two owners at once is impossible at the database level.

## Deploy (Railway)

Build with the `Dockerfile` in this folder. Set the variables from `.env.example`; `PUBLIC_URL` must be the public HTTPS origin of the API and `APP_URL`/`CORS_ORIGINS` the frontend origin. Redis must run with `maxmemory-policy noeviction`. The container runs `prisma migrate deploy` and then starts the API; the BullMQ workers run inside the same process.
