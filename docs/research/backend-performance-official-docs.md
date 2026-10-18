# Backend stack — official-docs research (verified 2026-10-18)

Scope: NestJS, Fastify, BullMQ, Socket.IO, throttler, helmet, argon2/OWASP, Pino. Only vendor documentation was used. Decision taken in `AGENTS.md`: pin **NestJS 11** (not 12) for this hackathon; the Nest 12 notes below are kept for awareness.

## Version snapshot

| Package | Current stable | Source |
|---|---|---|
| NestJS core / platform-fastify / platform-socket.io | 12.1.3 (12 Oct 2026); 11.2.6 maintained | https://github.com/nestjs/nest/releases |
| Fastify | 5.12.x — only LTS line | https://fastify.dev/docs/latest/Reference/LTS/ |
| BullMQ | 6.3.x (v6 since 30 Jul 2026; `ioredis` is an optional peer) | https://docs.bullmq.io/changelog |
| @nestjs/bullmq | 12.0.0 (peer bullmq ^3–^6) | npm |
| Socket.IO server | 4.8.4; `@socket.io/redis-adapter` 8.3.0 | npm |
| @nestjs/throttler | 6.7.1; `@nest-lab/throttler-storage-redis` 1.2.0 | npm |
| @fastify/helmet | ≥12 for Fastify 5 | https://github.com/fastify/fastify-helmet |
| argon2 (node-argon2) | 0.45.x | https://github.com/ranisalt/node-argon2 |
| zod | 4.6.x; `nestjs-zod` 5.5 (peers Nest 10/11 only) | npm |
| pino / nestjs-pino | pino 10.x; nestjs-pino 5.3 | npm |

## NestJS

- **Fastify adapter** — https://docs.nestjs.com/techniques/performance. `NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { rawBody: true })`; listen on `0.0.0.0`; Express-only middleware does not work, use `@fastify/*` plugins.
- **Raw body for webhooks** — https://docs.nestjs.com/faq/raw-body. `{ rawBody: true }` on create; read `req.rawBody` via `RawBodyRequest<FastifyRequest>`; keep the built-in body parser enabled; default body limit 1 MiB.
- **Request lifecycle** — https://docs.nestjs.com/faq/request-lifecycle. middleware → guards → interceptors (in) → pipes → handler → interceptors (out) → filters. Auth/permissions in guards, validation in pipes.
- **Guards** — https://docs.nestjs.com/guards. `Reflector.createDecorator()` metadata, `APP_GUARD` registration for DI, ordered chain (auth guard then permission guard), `@Public()` bypass.
- **Validation** — https://docs.nestjs.com/techniques/validation and https://docs.nestjs.com/pipes. Nest 11: `nestjs-zod` `ZodValidationPipe` globally, or `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`. Zod requires `strictNullChecks`. (Nest 12 adds a built-in Standard Schema pipe.)
- **Serialization** — https://docs.nestjs.com/techniques/serialization. Interceptor that allow-lists response fields (how we strip `passwordHash` and masked `value`).
- **Exception filters** — https://docs.nestjs.com/exception-filters. One global `@Catch()` filter using `HttpAdapterHost` so it is platform-agnostic.
- **Modules** — https://docs.nestjs.com/modules. Feature module per domain, providers private unless exported, `@Global()` only for config/logger.
- **Queues** — https://docs.nestjs.com/techniques/queues. `BullModule.forRootAsync`, `registerQueue`, `@InjectQueue`, `@Processor() extends WorkerHost` with `process(job)` switching on `job.name`; jobs persist in Redis and are picked up after restart.
- **Task scheduling is not durable** — https://docs.nestjs.com/techniques/task-scheduling. `@Timeout/@Interval` are `setTimeout/setInterval`; "runs every job in every process"; nothing survives restart. Use BullMQ delayed jobs.
- **Lifecycle** — https://docs.nestjs.com/fundamentals/lifecycle-events. `app.enableShutdownHooks()` so workers close on SIGTERM.
- **WebSockets** — https://docs.nestjs.com/websockets/gateways and https://docs.nestjs.com/websockets/adapter. Nest does not await async `handleConnection`, so authenticate in `io.use()`; Redis adapter via `IoAdapter` subclass; multi-instance needs websocket-only transport or sticky sessions.
- **Rate limiting** — https://docs.nestjs.com/security/rate-limiting. `ThrottlerModule.forRoot({ throttlers: [{ ttl, limit }], storage })`, `@Throttle()` on login, `@SkipThrottle()` on webhooks, set `trustProxy`.
- **Helmet** — https://docs.nestjs.com/security/helmet. Register `@fastify/helmet` first.
- **CSRF** — https://docs.nestjs.com/security/csrf. Nest 12.1 has `app.enableCsrfProtection()` (Fetch Metadata based). On Nest 11 we implement the same OWASP pattern as a small middleware: reject state-changing requests whose `Sec-Fetch-Site` is cross-site or whose `Origin` ≠ `APP_URL`, excluding webhook routes.
- **Config** — https://docs.nestjs.com/techniques/configuration. `ConfigModule.forRoot({ isGlobal, cache, validationSchema })`, fail fast on missing vars, `registerAs` namespaces.
- **Caching** — https://docs.nestjs.com/techniques/caching. `@nestjs/cache-manager` + Keyv Redis store; TTL in ms. Used for the role→permission map.
- **SWC builder** — https://docs.nestjs.com/recipes/swc. `nest start -b swc -w` for fast dev restarts.
- **Logging** — https://docs.nestjs.com/techniques/logger. `bufferLogs: true` + `app.useLogger(app.get(Logger))` with nestjs-pino.

## Fastify

- https://fastify.dev/docs/latest/Guides/Recommendations/ — run behind a proxy, set `trustProxy`, listen on `0.0.0.0`.
- https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/ — response schemas enable `fast-json-stringify`.
- https://fastify.dev/docs/latest/Reference/ContentTypeParser/ — alternative raw-body approach (`parseAs: 'buffer'`); oversized bodies are rejected before parsing (`bodyLimit`).

## BullMQ

Pattern used for ack windows ("run at T, cancel if acknowledged first"):

1. On assignment: `queue.add('escalate', data, { delay, jobId: 'esc-<leadId>-<assignmentId>', attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 86400 } })`.
2. On ack: `(await queue.getJob(id))?.remove()`; tolerate the "locked by another worker" error.
3. In the processor always re-read the assignment in a DB transaction before escalating; BullMQ is at-least-once.

Sources: delayed jobs https://docs.bullmq.io/guide/jobs/delayed · job ids (no `:`; duplicates ignored while the id exists) https://docs.bullmq.io/guide/jobs/job-ids · deduplication option https://docs.bullmq.io/guide/jobs/deduplication · removing https://docs.bullmq.io/guide/jobs/removing-job · retries/backoff + `UnrecoverableError` https://docs.bullmq.io/guide/retrying-failing-jobs and https://docs.bullmq.io/patterns/stop-retrying-jobs · rate limiting (`limiter` is global per queue; `worker.rateLimit()` + `Worker.RateLimitError()` on 429) https://docs.bullmq.io/guide/rate-limiting · concurrency https://docs.bullmq.io/guide/workers/concurrency · stalled jobs (lockDuration 30 s, maxStalledCount 1) https://docs.bullmq.io/guide/workers/stalled-jobs · production (Redis `maxmemory-policy noeviction`, AOF, `maxRetriesPerRequest: null`, `worker.close()` on SIGTERM, retention via removeOnComplete/removeOnFail, no secrets in job data) https://docs.bullmq.io/guide/going-to-production · idempotent jobs https://docs.bullmq.io/patterns/idempotent-jobs · QueueEvents https://docs.bullmq.io/guide/events · v6 changes (`repeat` → Job Schedulers, `debounce` → `deduplication`) https://docs.bullmq.io/changelog

## Socket.IO

- Redis adapter (prefer ioredis; Pub/Sub only; sticky sessions or websocket-only transport) https://socket.io/docs/v4/redis-adapter/ · Streams adapter if connection-state recovery is wanted https://socket.io/docs/v4/redis-streams-adapter/
- Rooms (`ws:<workspaceId>`, `user:<userId>`) https://socket.io/docs/v4/rooms/
- Handshake auth middleware `io.use()` https://socket.io/docs/v4/middlewares/
- Multiple nodes https://socket.io/docs/v4/using-multiple-nodes/ · emitting from outside handlers / redis-emitter https://socket.io/docs/v4/server-instance/
- Server options (`pingTimeout`, `maxHttpBufferSize`, explicit CORS origins) https://socket.io/docs/v4/server-options/ · performance tuning https://socket.io/docs/v4/performance-tuning/

## Security references

- Throttler README (custom `getTracker` to key login attempts by account + IP) https://github.com/nestjs/throttler · Redis storage https://github.com/jmcdo29/nest-lab/tree/main/packages/throttler-storage-redis
- OWASP Password Storage (Argon2id minimum m=19456, t=2, p=1) https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html · node-argon2 options https://github.com/ranisalt/node-argon2/wiki/Options
- OWASP CSRF (Fetch Metadata primary, Origin fallback, SameSite defence in depth) https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP Session Management (CSPRNG ids, HttpOnly/Secure/SameSite, idle + absolute timeout, server-side invalidation, list/revoke sessions) https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Authentication (throttle per account, generic errors, constant-time behaviour) https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP XSS (framework escaping, no raw HTML, CSP as defence in depth) https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- Pino redaction https://github.com/pinojs/pino/blob/main/docs/redaction.md · async logging https://github.com/pinojs/pino/blob/main/docs/asynchronous.md · nestjs-pino (`genReqId` must be set on `FastifyAdapter`) https://github.com/iamolegga/nestjs-pino
- Stripe raw body + retries + dedupe https://docs.stripe.com/webhooks · Twilio signature validation https://www.twilio.com/docs/usage/webhooks/webhooks-security

## Requirement → mechanism

| Req | Mechanism |
|---|---|
| Q1 | argon2id (OWASP params), server-side sessions with idle + absolute TTL, HttpOnly/Secure/SameSite cookie, login throttle per account + IP with Redis storage, generic error, helmet |
| Q2 | `APP_GUARD` chain AuthGuard → PermissionGuard reading `@RequirePermission()` metadata; permission map cached in Redis |
| Q3 | Zod validation pipe on every input, serializer allow-list on output, Fastify `bodyLimit`, helmet CSP |
| Q5 | BullMQ delayed jobs in persisted Redis, deterministic job ids, state re-check in processor, `enableShutdownHooks` + `worker.close()` |
| Q11 | Socket.IO gateway with rooms, `io.use()` auth, emit from services |
| Q13 | `@nestjs/config` with Zod validation, Pino redaction, no secrets in job data |
| Q14 | feature modules, controller/service/repository/provider layering, `APP_*` tokens for cross-cutting |
| F3.8 | job id `esc-<leadId>-<assignmentId>` + remove on ack + DB re-check + partial unique index |
| I1.8 / I2.4 | verify on `req.rawBody`, insert `integration_events` with unique external id, 2xx immediately, process in queue |
| I5.5 | `attempts` + exponential backoff with jitter, `UnrecoverableError` on 4xx, `limiter` on provider queues |

## Caveats
- BullMQ API reference site was unreachable; worker defaults were read from source.
- `@nestjs/bullmq` docs do not document worker concurrency or graceful shutdown; configure via `WorkerHost` options and `onApplicationShutdown`.
- `@nestjs/authentication` and `@nestjs/locks` are 0.x packages for Nest 12 only; not used.
