# PLAN.md — 6 hours, 3 people, built on Twenty CRM

Repository: https://github.com/abdullah-netiz/Web-Dev-Hackathon · Base: https://github.com/twentyhq/twenty (fork, commit `289976e`)
Requirements: `docs/problem-statement.md` · Engineering rules: `AGENTS.md` · Research: `docs/research/`

## 1. Context

The problem statement asks for a multi-tenant platform where a company manages its CRM, guarantees every
inbound lead has one accountable owner at every moment, and talks to customers, collects payments and books
appointments through real sandbox integrations, with every action traceable. Judges score the quality
requirements (Q1–Q14) as hard as the features.

Decision: reuse Twenty's backend as-is (accounts, permissions, custom data model, views, kanban, timeline,
dashboards, workflows, API, webhooks, live updates), rebrand its frontend, and build only what Twenty lacks in a
companion NestJS service, `services/lead-engine`. With 3 people and 6 hours this trades a from-scratch
implementation of F1, F2, F4-partial and F5 for a steeper setup hour and a dependency on Twenty's API.

Two things to say plainly before starting:
- **Licence and originality.** Twenty is AGPL-3.0. Our fork and this repo stay public with notices intact, and the
  README states the product is built on Twenty. Check the hackathon rules allow building on an open-source base.
- **Multi-workspace needs a real domain.** Twenty's multi-workspace mode (one workspace per company, F1.1/F1.6)
  routes by subdomain. Buy or reuse a domain in the first 15 minutes and point a wildcard record at Railway.
  Fallback if impossible: single-workspace mode, and demonstrate isolation with roles and row-level permissions only.

## 2. What Twenty gives us vs what we build

| Requirement area | Twenty (configured, not coded) | lead-engine (coded) |
|---|---|---|
| F1 accounts, roles, permissions | Sign up creates workspace (multi-workspace mode); invites; roles with permission flags; object permissions (read/update/delete); **field permissions** hide `Opportunity.amount` (F1.4); row-level predicates (`assignee = me`); server-side GraphQL/REST guards (F1.5); CSV export respects field permissions | — |
| F2 CRM | People, Companies, Opportunities with `stage` select → kanban board; custom fields of type text/number/date/select/boolean from Settings → Data model (F2.2); custom objects per pipeline (F2.3 via a second opportunity-like object or a `pipeline` select + conditional views); views with multi-criteria filters, saved and shared (F2.6); timeline activities on every record (F2.7); record page shows related custom objects (F2.8) | Stage-required fields (F2.4): workflow on `opportunity.updated` that checks required fields for the target stage and reverts + notifies, or Twenty validation rules if available |
| F3 lead engine | `Lead`, `LeadEvent`, `MemberAvailability`, `LeadSettings` objects; "Acknowledge" as a workflow manual action that sets `acknowledgedAt`; views "My leads", "Recovery queue" (`recoveryReason != NONE`, grouped by reason); live updates | Intake (public form, Twilio inbound, manual via webhook), round-robin assignment with limits and availability, BullMQ ack timers, escalation chain, reassignment on availability change, recovery marking, idle detection, reconciliation on restart, dedupe guarantees |
| F4 audit | Timeline activities record field changes with actor; `AuditEvent` custom object with read-only role permissions | Writes `AuditEvent` for assignment/ack/escalation/reassignment/integration changes/alerts/deletions (via `*.deleted` webhooks) |
| F5 dashboard | Dashboards with aggregate widgets over objects (count/sum/avg with filters), per-role via object/row permissions, user-arranged layout (F5.5) | Computes `timeToFirstResponseSec`, `recoveryReason`, payment statuses so widgets can aggregate them |
| I1 Twilio WhatsApp | `Conversation`/`Message` objects, conversation view = Message list grouped by conversation, related on Person | Inbound webhook + signature + dedupe; outbound send via workflow HTTP step or lead-engine endpoint; status callbacks; opt-out; failed + retry |
| I2 Stripe | `Payment` object on Opportunity and Person; "Request payment" workflow manual action → HTTP to lead-engine | Checkout Session creation with idempotency key; webhook verification; statuses; refunds; collected vs projected |
| I3 Google Calendar | `Appointment` object; "Book appointment" workflow action → HTTP to lead-engine | Own OAuth flow per member (offline access, encrypted refresh token), FreeBusy conflict check, insert/patch/delete, time zones, reconnect state |
| I4 Telegram | `AlertDelivery` object; member's `telegramChatId` on `MemberAvailability` | Bot webhook for `/start <code>` linking; escalation alerts with deep link; retries; delivery log |
| I5 shared | `IntegrationConnection` + `IntegrationEvent` objects → Integrations view with status, last OK, errors, limits text | Health tracking, event mirror, retry policy, per-workspace credentials, isolation via queues |
| Q7–Q10 UI quality | Twenty's UI is keyboard-navigable, labelled, themed; responsive layout exists for phone widths | Public intake form page (one HTML page) must be responsive and accessible |
| Q11 real-time | GraphQL subscriptions update open views and records | Writes through the API trigger those updates |

## 3. Architecture

```
Browser ── https://<ws>.<domain> ──► front (static Vite build of our rebranded twenty-front, Railway)
                                 ──► twenty-server (official image) ── Postgres ── Redis ── twenty-worker
                                        │ REST + API key                ▲ outbound webhooks (lead.*, person.*, *.deleted, integrationConnection.*)
                                        ▼                               │
                                 lead-engine (NestJS, Railway) ── Prisma (schema lead_engine) ── BullMQ (same Redis)
                                        ▲ webhooks: /webhooks/twilio, /webhooks/twilio/status, /webhooks/stripe, /webhooks/telegram, /twenty/webhooks
                                        ▲ public: /f/<workspace> intake form, /calendar/google/callback, /telegram/link/<code>
```

## 4. Lead engine (F3)

```
intake(source) → create Lead(status NEW) in Twenty → assign():
  candidates = MemberAvailability where status=AVAILABLE and openLeadCount < maxOpenLeads, order by lastAssignedAt
  pick next after roundRobinCursor (transaction in lead_engine schema holds the cursor row FOR UPDATE)
  update Lead {assignee, assignmentId=uuid, assignedAt, dueAt=now+ackWindowSec, status ASSIGNED, escalationLevel}
  LeadEvent ASSIGNED, AuditEvent, BullMQ delayed job esc-<leadId>-<assignmentId>
ack (workflow action sets acknowledgedAt, or any Message/Note/stage change/Appointment on the lead → lead.updated webhook):
  status ACKNOWLEDGED, timeToFirstResponseSec, remove job, LeadEvent ACKNOWLEDGED, AuditEvent
job fires: re-read Lead; if still ASSIGNED and assignmentId matches → level+1:
  level 1 next AVAILABLE member, level 2 backupMember, level 3 isManager member; new assignmentId/dueAt/job
  LeadEvent ESCALATED, AuditEvent, AlertDelivery → Telegram
availability → ON_LEAVE/OFFLINE (memberAvailability.updated webhook): reassign that member's ASSIGNED leads now; ACKNOWLEDGED leads stay (text shown in LeadSettings description)
recovery job every 30 s: recoveryReason = OVERDUE (ASSIGNED and dueAt<now) | ESCALATED_TWICE (escalationCount>=2) | IDLE (lastActivityAt < now-idleSec); else NONE
startup: sweep ASSIGNED leads with dueAt < now and no job → enqueue delay 0
```

No duplicates: `assignmentId` check in the processor, deterministic job id, `lead_engine.lead_locks` row lock per lead during assign/escalate.

## 5. Team split

| Person | Track | Owns |
|---|---|---|
| **Dev A — Twenty platform & data model** | Deploy Twenty on Railway (server, worker, Postgres, Redis) with multi-workspace + wildcard domain; local docker compose; create objects, fields, roles, field/row permissions, views, dashboard and workflows in a demo workspace; export them as `twenty-app/` JSON + `scripts/apply-data-model.ts` so a second workspace can be set up in minutes; configure outbound webhooks and API keys; seed data | `infra/`, `twenty-app/`, Twenty settings |
| **Dev B — lead-engine** | NestJS service: Twenty client, workspace connections, lead engine, Twilio, Stripe, Telegram, Google Calendar, audit, metrics, intake form page, Railway deploy, provider accounts and webhook registration | `services/lead-engine/` |
| **Dev C — frontend identity** | Fork Twenty → branch `brand`; rename, logo, icons, colours, footer, titles, emails; build front with `REACT_APP_SERVER_BASE_URL`; deploy as static service on the wildcard domain; verify sign-up, kanban, views, dashboard at 375 px and by keyboard; write `docs/demo-script.md` and README | `twenty/` submodule, `front` service, docs |

Hand-offs: A publishes object/field names (`twenty-app/objects/*.json`) by minute 45; B codes against them. A gives B a demo-workspace API key and webhook secret by minute 60. C needs A's server URL by minute 90 for the first front deploy.

## 6. Timeline

| Window | Dev A (Twenty) | Dev B (lead-engine) | Dev C (frontend) |
|---|---|---|---|
| **0:00–0:30** | Railway project: Postgres, Redis, `twenty-server`, `twenty-worker` from `twentycrm/twenty`; env from `AGENTS.md §10`; domain + wildcard DNS; first sign-up works on `app.<domain>` | Scaffold Nest 11 + Fastify + Prisma + BullMQ; Twenty REST client with API key; `integration_events`; create Twilio sandbox, Stripe test keys, Telegram bot, Google OAuth client | Fork Twenty, add as submodule, `yarn install` (Node 24), run `twenty-front` locally against A's server; pick name, logo, palette with the team |
| **0:30–1:30** | Objects from `AGENTS.md §7` in the demo workspace; roles Owner/Admin/Manager/User with field permission on `Opportunity.amount` and row predicate on `Lead`; views: My leads, Recovery queue, Conversations, Payments, Integrations; export JSON | Workspace connections + encrypted credentials; intake form + `POST /intake/:slug`; assignment + ack + escalation processor + reconciliation; `/twenty/webhooks` handler for `lead.updated`, `memberAvailability.updated`, `*.deleted` | Branding files (§6 of AGENTS.md): title, icons, Logo, FooterNote, theme tokens, email header; remove upstream links |
| **1:30–3:00** | Workflows: "Acknowledge" manual action (set `acknowledgedAt`), "Request payment" and "Book appointment" manual actions calling lead-engine with the workspace key, stage-required-fields guard on `opportunity.updated`; outbound webhooks to lead-engine; dashboard widgets for F5.1 | Twilio inbound/outbound/status/opt-out; Telegram link flow + escalation alerts with retries; Stripe checkout + webhook statuses + refunds; AuditEvent writer | First production build + deploy of `front`; walk every screen at 375 px; fix any contrast change from palette; verify kanban drag, filters, CSV export respects hidden amount |
| **3:00–4:15** | Second workspace created from `apply-data-model` to prove isolation; seed 300 people, 60 opportunities, 40 leads; dashboard drill-down views linked from widgets | Google OAuth connect/disconnect, FreeBusy conflict check, create/cancel event, `Appointment` records; metrics job (`timeToFirstResponseSec`, recovery reasons); `IntegrationConnection` health + limits text | README (zero-to-running, Q13), `docs/demo-script.md`; Lighthouse accessibility on sign-in, kanban, dashboard; Telegram/Twilio limits text reviewed for I5.6 |
| **4:15–5:15** | Full demo run on production with B and C; fix | Full demo run; restart lead-engine mid-timer and confirm single escalation; replay webhooks for dedupe; forged signature → 403 | Full demo run from a phone; screenshots for fallback |
| **5:15–6:00** | Buffer; export final `twenty-app/` JSON | Buffer; `pnpm test` green | Buffer; rehearse 7-minute demo |

**Cut lines** (in order, if a track is > 30 min behind): I3.4 conflict check (book without FreeBusy) → I3.6 reschedule (keep cancel) → F2.3 second pipeline (one opportunity object) → I2.5 refund UI (keep webhook handling) → IDLE recovery reason → Twilio outbound from UI (keep inbound + lead creation). **Never cut:** multi-tenant isolation, field permission on amount, ack timer + escalation + Telegram alert, restart survival, Stripe webhook-driven status, AuditEvent.

## 7. Requirement → NFR traceability

| Req | Complements | Mechanism |
|---|---|---|
| F1.1 sign up / login / sessions | Q1, Q6 | Twenty: bcrypt password auth, access + refresh tokens with expiry (`ACCESS_TOKEN_EXPIRES_IN`), sessions in Postgres/Redis, multi-workspace creation on sign-up |
| F1.2 base levels | Q2, F4.1 | Twenty roles `Owner` (admin role, not editable by Admin), `Admin`, `User`; role changes visible in Twenty; limitation noted in §9 |
| F1.3 configurable permissions | Q2, Q12 | Twenty role editor: permission flags (workspace, members, roles, data model, workflows, API keys, export CSV…), per-object read/update/delete, per-field |
| F1.4 value masking | Q2, Q12 | Twenty field permission on `Opportunity.amount` for `User` role: hidden in lists, record, exports |
| F1.5 server enforcement | Q2, Q3 | Twenty GraphQL/REST resolvers enforce permissions; lead-engine browser-facing routes limited to public intake, OAuth callback, webhooks; demo with direct API call → 403 |
| F1.6 isolation | Q2, Q4 | Twenty workspace-scoped schemas; lead-engine per-workspace API keys; guessed ids across workspaces → 404 |
| F2.1 relationships | Q4, Q9 | Twenty standard objects + relations; paginated record lists |
| F2.2 custom fields | Q3, Q6 | Twenty data model UI; stored per workspace; validated by Twenty |
| F2.3 fields per pipeline | Q12 | second pipeline object or `pipeline` select with conditional views; same Person relation |
| F2.4 stage-required fields | Q3, Q10 | workflow `opportunity.updated` → IF_ELSE missing required fields → UPDATE_RECORD revert + SEND_CHAT_MESSAGE to actor with the list |
| F2.5 pipeline editing | Q4, F4.1 | Twenty select options add/rename/reorder; deleting an option is blocked by Twenty while values exist (document the "move first" step); timeline records the change |
| F2.6 saved lists | Q9, Q12 | Twenty views with filter groups, saved, live |
| F2.7 activity history | Q9, Q12 | Twenty timeline activities + `LeadEvent`/`Message`/`Payment`/`Appointment` relations |
| F2.8 complete customer view | Q11, Q12 | Person record page: Opportunities, Conversations/Messages, Payments, Appointments, Leads, timeline |
| F3.1 capture sources | Q3, Q11 | lead-engine intake form (Zod validated, throttled), Twilio inbound, manual create in Twenty → webhook; `source` select |
| F3.2 availability | Q11, F3.6 | `MemberAvailability.status`; webhook on change → reassignment |
| F3.3 assignment rules | Q5, Q6 | round-robin with cursor row lock; `maxOpenLeads`; non-AVAILABLE never eligible |
| F3.4 ack window | Q5, Q10, Q11 | `dueAt` visible on Lead; BullMQ delayed job; Acknowledge action |
| F3.5 escalation chain | Q5, Q11, I4 | processor levels next → backup → manager; `LeadSettings.escalationLevels/levelWindowSec`; Telegram alert |
| F3.6 reassignment on absence | Q4, Q5 | bulk reassignment job; acknowledged leads rule documented in `LeadSettings` |
| F3.7 recovery queue | Q9, Q12 | view on `recoveryReason != NONE` grouped by reason; computed by one job from Section 7 definitions |
| F3.8 no duplicates | Q4, Q5 | `assignmentId` compare-and-set, deterministic job id, per-lead lock row |
| F3.9 external alert | I4, Q11 | alerts queue → Telegram `sendMessage` with deep link; `AlertDelivery` |
| F4.1–F4.3 audit | Q2, Q4, Q6 | `AuditEvent` object written by lead-engine; role permissions read-only; no update/delete code path; Twenty views filter by type/actor/date |
| F5.1–F5.5 dashboard | Q9, Q11, Q12 | Twenty dashboard widgets: count Leads today, sum `Opportunity.amount` by stage (hidden for User by field permission), avg `timeToFirstResponseSec`, count `recoveryReason != NONE`, count `LeadEvent ESCALATED` last 24 h, count `MemberAvailability` by status, upcoming `Appointment`, sum `Payment PAID` this month; widget → view drill-down; per-user layout |
| I1.1–I1.9 | Q3, Q5, Q10, Q11 | signature on public URL; `MessageSid` dedupe; monotonic status transitions; `FAILED` + retry; opt-out field; sandbox limits text |
| I2.1–I2.8 | Q3, Q5, Q12 | hosted Checkout; `constructEvent`; `event.id` dedupe; statuses; collected vs projected via `Payment.status`; no card data |
| I3.1–I3.7 | Q1, Q4, Q13 | per-member OAuth tokens encrypted in lead-engine; auto refresh; `invalid_grant` → reconnect state shown on `MemberAvailability.calendarStatus`; UTC + time zone |
| I4.1–I4.4 | Q5, Q10 | queue limiter 25 msg/s; 3 retries; `AlertDelivery` visible to Admins |
| I5.1–I5.8 | Q13, Q14, Q10 | `IntegrationConnection` view; encrypted per-workspace credentials; `IntegrationEvent` mirror; provider interfaces; queue isolation; limits text |

## 8. Verification and demo script (`docs/demo-script.md`)

1. Zero-to-running from README: `infra/docker compose up`, `pnpm dev` in lead-engine, `apply-data-model` (Q13).
2. Sign up → new workspace on its own subdomain; second workspace cannot see the first's records by id (F1.1, F1.6).
3. Log in as User: amount hidden on kanban, record and CSV export; curl to Twenty REST as User for `amount` → not returned (F1.4, F1.5).
4. Set `ackWindowSec=20`. Submit the public form → Lead appears live in "My leads" with `dueAt` → no ack → escalates → Telegram alert on the new owner's phone → second expiry → manager → appears in Recovery queue with reason (F3, I4, Q11).
5. Acknowledge mid-window → no escalation. Restart `lead-engine` during a 60 s window → exactly one escalation afterwards (Q5).
6. WhatsApp from a real phone → Conversation + new Lead; reply from Twenty (Request-reply action) → delivered status; replay webhook → no duplicate; forged signature → 403 + IntegrationEvent (I1).
7. "Request payment" on an opportunity → Checkout → pay with `4242…` → Payment PAID without refresh; `stripe trigger checkout.session.expired` → EXPIRED; dashboard "payments this month" updates (I2).
8. Connect Google → book over a busy slot → warning → free slot → event in Google Calendar → cancel → gone + timeline entry (I3).
9. AuditEvent view filtered by `ESCALATED`; attempt to edit → read-only (F4).
10. Phone-width walkthrough of sign-in, kanban, record page, dashboard; keyboard through a record dialog (Q7, Q8).

Automated: `pnpm test` in lead-engine covers assignment selection, escalation levels, compare-and-set, webhook signature failures and dedupe.

## 9. Risks and open points

| Risk | Mitigation |
|---|---|
| Wildcard domain not available → no multi-workspace | Buy a domain at minute 0; fallback single-workspace mode and demonstrate isolation through roles/row-level predicates; state the limitation |
| Twenty learning curve (Nx, Yarn 4, Node 24, metadata model) | Backend runs from the official image, never built; only Dev C builds `twenty-front`; Dev A works in the UI and exports JSON |
| Front build memory (`--max-old-space-size=8192`) | Build on the strongest laptop, deploy the `dist` folder as a static service |
| Role/permission changes not auditable via webhooks | Document as partial; Twenty UI shows role membership; everything lead-engine does is audited |
| Twenty REST rate limits or API shape surprises | Twenty client with retry/backoff; test every call in hour 1 against the demo workspace; GraphQL fallback |
| Workflow manual actions unfamiliar | If an action proves slow to build, replace with a lead-engine endpoint linked from a URL field on the record |
| Google refresh tokens expire after 7 days in Testing | Connect on demo day; reconnect state built in |
| Provider setup eats time | Dev B creates all accounts in the first 30 minutes; credentials in a shared vault, seeded for the demo workspace |
