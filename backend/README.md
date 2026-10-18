# backend — Unified Business Management Platform API

NestJS 11 (Fastify) + Prisma 6 + PostgreSQL 16, with BullMQ 5 / Redis 7 for timer jobs.
See the root `AGENTS.md` for the non-negotiable rules and `PLAN.md` for the build plan.

## Run it

```bash
# 1. Datastores (Postgres on 5433, Redis on 6380)
docker compose -f ../infra/docker-compose.yml up -d

# 2. Config
cp .env.example .env          # then set APP_ENCRYPTION_KEY (openssl rand -hex 32)

# 3. Install, migrate, seed
pnpm install
pnpm prisma:migrate           # applies prisma/migrations incl. hand-written SQL
pnpm db:seed                  # demo workspace: owner@demo.test / Password123!

# 4. Develop / verify
pnpm dev                      # http://localhost:4000
pnpm test && pnpm typecheck && pnpm build
```

## Endpoints available today

| Route | Purpose |
|---|---|
| `GET /health` | liveness |
| `GET /health/ready` | readiness (checks the database) |
| `GET /meta/permissions` | the permission catalogue the API enforces (F1.2) |

Every success response is `{ data, meta? }` and every error is
`{ code, message, action?, details? }` (Q10).

## Layout

```
prisma/   schema.prisma, migrations/ (partial + GIN + trgm indexes, audit trigger), seed.ts
src/
  common/ prisma service, Zod validation pipe, global exception filter, permissions, encryption
  config/ boot-time env validation (Zod)
  health/ meta/  jobs/
```
