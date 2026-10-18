# Data layer and integrations — official-docs research (verified 2026-10-18)

Scope: PostgreSQL, Prisma, Stripe, Twilio WhatsApp Sandbox, Google Calendar OAuth, alert channels, tunnelling. Only vendor documentation was used. Decision taken in `AGENTS.md`: pin **Prisma 6** (CJS, familiar API) with hand-written SQL migrations for the index types Prisma cannot express.

## Version snapshot

| Component | Current | Source |
|---|---|---|
| PostgreSQL | 18 (17 supported; Railway/Docker `postgres:17` is fine) | https://www.postgresql.org/support/versioning/ |
| Prisma ORM | 8.0 RC (`latest`), 7.10 stable (`prev`), 6.x still installable | https://www.prisma.io/changelog |
| stripe (Node) | 23.x | https://docs.stripe.com/webhooks/quickstart?lang=node |
| twilio (Node) | 6.x | https://github.com/twilio/twilio-node |
| googleapis (Node) | 186.x (maintenance mode) | npm |
| Telegram Bot API | 10.x | https://core.telegram.org/bots/api |

## PostgreSQL

- Composite B-tree: leading columns matter most; `workspaceId` first. https://www.postgresql.org/docs/current/indexes-multicolumn.html
- Partial unique index enforces uniqueness among matching rows only (one `PENDING` assignment per lead). https://www.postgresql.org/docs/current/indexes-partial.html
- JSONB GIN with `jsonb_path_ops` for `@>` containment (equality on custom fields); expression B-tree indexes for number/date ranges. https://www.postgresql.org/docs/current/datatype-json.html#JSON-INDEXING
- `SELECT … FOR UPDATE SKIP LOCKED` for queue-like claims (assignment candidate pick, due-assignment sweep). https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE
- Advisory locks (`pg_try_advisory_xact_lock`) for cross-row critical sections such as stage reorder. https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
- FK actions: `RESTRICT` for stage/field → opportunity, `SET NULL` for optional owners, `CASCADE` only for pure children. https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK
- Row Level Security as defence in depth (`FORCE ROW LEVEL SECURITY`, policy on `current_setting('app.workspace_id', true)` set with `SET LOCAL`). https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Large `OFFSET` is computed server-side and gets slow; use keyset pagination on `(createdAt, id)`. https://www.postgresql.org/docs/current/queries-limit.html
- `pg_trgm` GIN (`gin_trgm_ops`) accelerates `ILIKE '%q%'`; needs ≥ 3 characters. https://www.postgresql.org/docs/current/pgtrgm.html
- `EXPLAIN (ANALYZE, BUFFERS)` to verify index use before the demo. https://www.postgresql.org/docs/current/using-explain.html
- Audit table: `REVOKE UPDATE, DELETE ON audit_events FROM app` in a manual migration (F4.3 at the database level).

## Prisma

- Query optimization: `select` to avoid over-fetching; `include` is a second query, not N+1; bulk methods; one shared client. https://www.prisma.io/docs/orm/prisma-client/queries/query-optimization-performance
- Optimistic concurrency: `version` column + `updateMany({ where: { id, version } })`, 409 when `count === 0`. https://www.prisma.io/docs/orm/prisma-client/queries/transactions#optimistic-concurrency-control
- Interactive transactions with `isolationLevel: Serializable`; retry on `P2034`. https://www.prisma.io/docs/orm/prisma-client/queries/transactions
- Cursor pagination `{ take, skip: 1, cursor }`. https://www.prisma.io/docs/orm/prisma-client/queries/pagination
- JSON filtering `path / equals / string_contains (mode insensitive) / array_contains`; cannot order by a JSON property. https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields
- Indexes in schema: `@@index([custom(ops: JsonbPathOps)], type: Gin)`, sort order per column; partial and function indexes are not expressible in Prisma 6 → manual migration SQL. https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes
- Client extensions `$allModels.$allOperations` to inject `workspaceId` into `where` (and `data` on create); does not cover `$queryRaw`. https://www.prisma.io/docs/orm/prisma-client/client-extensions/query
- Migrations: `migrate dev` locally only; `migrate deploy` in Railway's release command. https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production
- Slow-query logging via `log: [{ emit: 'event', level: 'query' }]`. https://www.prisma.io/docs/orm/prisma-client/observability-and-logging/logging
- Connection pool: in Prisma 6 the client pools itself (`connection_limit` in the URL, default `num_cpus * 2 + 1`); Railway Postgres allows plenty for one API instance. https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool
- Prisma 7 notes (not used): ESM-only, `@prisma/adapter-pg` required, `prisma.config.ts`, `$use` removed. https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7

## Stripe

- Checkout Sessions per customer (`client_reference_id`, `metadata`, `customer_email`, `expires_at` 30 min–24 h, `success_url` with `{CHECKOUT_SESSION_ID}`); Payment Links are reusable and also built on Checkout. https://docs.stripe.com/api/checkout/sessions/create · https://docs.stripe.com/payment-links
- Fulfilment: `checkout.session.completed` (+ `async_payment_succeeded/failed`), check `payment_status != 'unpaid'`, handler may be called more than once. https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted
- Event types used: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`, `refund.created`. https://docs.stripe.com/api/events/types
- Webhooks: raw body, `Stripe-Signature`, `constructEvent`, 5-minute tolerance, unordered delivery, sandbox retries 3 times over a few hours, dedupe by `event.id`, return 2xx fast. https://docs.stripe.com/webhooks
- Idempotency keys on every POST (≤ 255 chars, 24 h). https://docs.stripe.com/api/idempotent_requests
- Refunds API and events. https://docs.stripe.com/refunds
- Test cards (`4242 4242 4242 4242` success, `4000 0000 0000 0002` decline, `4000 0025 0000 3155` 3DS). https://docs.stripe.com/testing
- CLI `stripe listen --forward-to … --events …`, `stripe trigger checkout.session.expired`. https://docs.stripe.com/cli/listen
- Hosted Checkout keeps card data off our servers. https://docs.stripe.com/security/guide

## Twilio WhatsApp Sandbox

- Sandbox number +1 415 523 8886; join phrase; **session expires 3 days after joining**; only joined numbers reachable (error 63015); **one message every 3 seconds**; messages outside the 24-hour window must use the pre-approved templates via `contentSid`; configure in the legacy Console. https://www.twilio.com/docs/whatsapp/sandbox
- Inbound webhook params (`MessageSid`, `From` as `whatsapp:+E164`, `Body`, `NumMedia`, `ProfileName`, `WaId`). https://www.twilio.com/docs/messaging/guides/webhook-request
- Status callbacks (`queued, sending, sent, delivered, undelivered, failed, read`) arrive **out of order**; set `statusCallback` per message. https://www.twilio.com/docs/messaging/guides/track-outbound-message-status
- Signature: `twilio.validateRequest(authToken, signature, publicUrl, params)`; the URL must be the exact public URL Twilio called (tunnel/proxy gotcha). https://www.twilio.com/docs/usage/webhooks/webhooks-security
- Error 63016 = free-form message outside the 24-hour window. https://www.twilio.com/docs/api/errors/63016
- Twilio's STOP handling applies to SMS, **not WhatsApp** (unless Advanced Opt-Out on a Messaging Service) → we implement opt-out ourselves. https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out
- Webhook retries are off by default; connection overrides can enable them. https://www.twilio.com/docs/usage/webhooks/webhooks-connection-overrides

## Google Calendar API

- Web-server OAuth flow: `generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope, state })`; refresh token only on first consent unless `prompt=consent`. https://developers.google.com/identity/protocols/oauth2/web-server
- Testing publishing status: **refresh tokens expire after 7 days**, 100 test users max, 100 tokens per user per client. https://developers.google.com/identity/protocols/oauth2#expiration · https://support.google.com/cloud/answer/15549945
- Scopes: use `calendar.events` + `calendar.freebusy`, never full `calendar`. https://developers.google.com/workspace/calendar/api/auth
- FreeBusy query. https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
- Events insert/patch/delete with `{ dateTime, timeZone }`, `sendUpdates`. https://developers.google.com/workspace/calendar/api/v3/reference/events/insert · https://developers.google.com/workspace/calendar/api/concepts/events-calendars
- Quotas: 600 req/min/user; back off on 403/429 `usageLimits`. https://developers.google.com/workspace/calendar/api/guides/quota
- Sync tokens / push notifications (skipped for the hackathon). https://developers.google.com/workspace/calendar/api/guides/sync · https://developers.google.com/workspace/calendar/api/guides/push

## Alert channel (I4) comparison

| | Telegram | Slack | Resend |
|---|---|---|---|
| Setup | BotFather token; user messages the bot once; `sendMessage(chat_id, text)` | Slack app with `chat:write`, install to workspace, `chat.postMessage` | API key; `POST /emails` |
| Approval | none | workspace admin | domain DNS verification before emailing anyone but yourself |
| Limits | ~30 msg/s overall, ~1 msg/s per chat | ~1 msg/s per channel | 10 req/s; free 100/day |
| Docs | https://core.telegram.org/bots/api · https://core.telegram.org/bots/faq | https://docs.slack.dev/reference/methods/chat.postMessage/ · https://docs.slack.dev/apis/web-api/rate-limits/ | https://resend.com/docs/api-reference/emails/send-email · https://resend.com/docs/knowledge-base/403-error-resend-dev-domain |

Chosen: **Telegram** (zero approval, instant). Store deliveries keyed `(leadAssignmentId, channel)` with a unique index so a retried job never double-sends.

## Local webhook tunnelling

- ngrok free: one static `*.ngrok-free.app` dev domain, 20k requests/month; webhooks unaffected by the browser interstitial. https://ngrok.com/docs/pricing-limits/free-plan-limits
- Cloudflare quick tunnel: no account, random hostname per run. https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- Stripe needs no tunnel: `stripe listen`. https://docs.stripe.com/cli/listen

## Requirement → mechanism

| Req | Mechanism |
|---|---|
| F1.6 | `workspaceId` on every row + Prisma extension injecting it; RLS as backstop for raw SQL |
| F2.2 | definitions table + JSONB values + GIN `jsonb_path_ops`; expression indexes for ranges |
| F2.5 | `ON DELETE RESTRICT` from stage to opportunity; reassign-then-delete in one transaction |
| F3.8 | partial unique index on `PENDING` assignment + `FOR UPDATE SKIP LOCKED` + job-id dedupe |
| F4.3 | `REVOKE UPDATE, DELETE` on `audit_events`; no code path |
| Q4 | `version` + `updateMany` count check → 409; explicit FK actions |
| Q5 | Serializable transaction with `P2034` retry for the claim; advisory lock for reorder |
| Q9 | keyset pagination, `pg_trgm`, composite indexes, `EXPLAIN ANALYZE` |
| I1.2 / I2.3 | `validateRequest` on the public URL; `constructEvent` on the raw body |
| I1.8 / I2.4 | `integration_events (provider, externalEventId)` unique, insert before process; Stripe idempotency keys on outbound calls |
| I3.2 | offline access + consent prompt, encrypted refresh token, `on('tokens')` persistence, `invalid_grant` → reconnect state |

## Caveats
- Telegram docs were read via snippets (direct fetch failed); limits are approximate.
- Twilio messaging callback timeout/retry policy was not explicitly confirmed (15 s documented for Voice).
- RLS `current_setting()` tenant pattern is standard practice but not quoted verbatim in the PostgreSQL pages.
