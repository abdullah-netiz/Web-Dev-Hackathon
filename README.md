# Unified Business Management Platform

One connected platform for small service companies: a customizable CRM, a lead engine that guarantees every
incoming lead has exactly one accountable owner (round-robin assignment, acknowledgement windows, automatic
escalation, recovery queue), an append-only audit history, a live dashboard, and real sandbox integrations
with Twilio WhatsApp, Lemon Squeezy payments, Google Calendar and Slack. Every service used works from Pakistan.

| Where | What |
|---|---|
| [`docs/problem-statement.md`](docs/problem-statement.md) | the requirements this implements (F1–F5, I1–I5, Q1–Q14) |
| [`PLAN.md`](PLAN.md) | 6-hour build plan, team split, requirement → quality traceability |
| [`AGENTS.md`](AGENTS.md) | engineering rules for humans and coding agents |
| [`docs/api.md`](docs/api.md) | API reference the frontend builds against |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | deploy: Supabase + Render + Vercel, provider setup |
| [`docs/self-check.md`](docs/self-check.md) | status against the Participant Rubric |
| [`docs/demo-script.md`](docs/demo-script.md) | 10-minute demo order |
| [`backend/`](backend/README.md) | NestJS API: setup, seed logins, lead engine, deploy |
| `frontend/` | Next.js 16 app *Baton* (live API by default; `NEXT_PUBLIC_API_MODE=mock` for in-browser data) |
| [`infra/docker-compose.yml`](infra/docker-compose.yml) | Postgres and Redis for local development |
| [`docs/research/`](docs/research) | official-documentation research behind the stack choices |

## Quick start

```bash
docker compose -f infra/docker-compose.yml up -d
cd backend && pnpm install && cp .env.example .env    # set APP_ENCRYPTION_KEY
pnpm prisma:deploy && pnpm seed && pnpm dev            # API on http://localhost:4000
cd ../frontend && npm install && cp .env.example .env.local && npm run dev   # app on :3000
```

Log in with `owner@demo.test` / `Demo1234!` (see `backend/README.md` for all seed users), or submit the public
lead form at `http://localhost:3000/f/demo` and watch the lead get assigned, time out and escalate.

Twenty CRM (https://github.com/twentyhq/twenty) was used as a design reference for how a production CRM
backend structures workspaces, metadata-driven custom fields, timeline events and queue-based automation.
No code was copied.
