# Hackathon Brief — Unified Business Management Platform

> Quick-reference summary. Full details in [problem-statement.md](./problem-statement.md).
> Requirement-by-requirement checklist in [requirements-matrix.md](./requirements-matrix.md).

## What the hackathon is actually about

Build **one connected multi-tenant web platform** for small service businesses (5–30 employees: real-estate agencies, solar installers, clinic acquisition teams) that:

1. **Protects every lead** — every incoming lead has exactly ONE accountable owner at any moment, and escalates automatically if ignored. (This is the *central* business problem.)
2. **Fully customizable CRM** — each company shapes its own pipeline, fields and rules via UI, no developer help.
3. **Real third-party integrations** — actual sandbox/test-mode external services (Twilio WhatsApp, Stripe, Google Calendar + one chosen notification provider), with real webhooks, real signature verification, real failure handling. Not mocks.
4. **Traceability everywhere** — audit log of every important action; managers see true pipeline state, response times, missed opportunities.

Core insight from the statement: *"A lead must never be left without an accountable person."* That is the heart of the product; everything else supports it.

## Target users

| User | Role |
|---|---|
| Owner | Runs company; controls workspace, roles, settings; sees revenue/perf |
| Admin | Delegated config: pipelines, fields, assignment rules, integrations |
| Manager | **Not hard-coded** — a configurable role built from permissions. Supervises, reassigns |
| User (Sales/Support) | Works assigned leads, replies to customers, records notes |
| Customer (external) | Expects fast reply on their channel, payment link, confirmed appointment |

Owner/Admin/User = 3 base levels. Manager = permission-composed role.

## Scope

**Must be solved now:** accounts/workspaces/roles/permissions · customizable CRM · lead capture→assignment→acknowledgement→escalation→recovery · audit history · operational dashboard on live data · 4 real integrations (3 mandatory + 1 chosen).

**Out of scope (explicitly):** full accounting/ledgers · payroll/shifts/legal leave rules · ad-platform analytics · report builder/BI · training modules · public marketing site · platform billing.

## Functional areas (F1–F5) at a glance

| Area | # reqs | Gist |
|---|---|---|
| F1 Accounts, roles, permissions | 6 | Sign up creates workspace+Owner; invite users; **configurable permissions**, not role names; field-level protection (hide opportunity value); **server-side enforcement**; workspace isolation (anti-IDOR) |
| F2 Customizable CRM | 8 | Contacts→companies→opportunities; custom fields typed via UI (text/number/date/dropdown/checkbox); per-pipeline field sets; stage-required fields; customizable stages w/ safe delete; filtering + saved lists (≥3 criteria); activity history per record; one complete customer view |
| F3 Lead capture→escalation | 9 | Capture: web form + incoming message + manual, each with source label; employee availability status (Available/Busy/On leave/Offline); round-robin + max-open-leads rules; acknowledgement window w/ visible countdown; escalation chain (next eligible → backup → manager); reassign on absence; recovery queue; **no duplicate ownership / no double escalation (F3.8)**; external alert on escalation |
| F4 Audit history | 3 | Record assignment/ack/escalation/role/config/integration changes w/ actor, time, target, before/after; restricted visibility + filters; **tamper-proof** (no edit/delete anywhere) |
| F5 Dashboard | 5 | Live: new leads today, open pipeline value by stage, avg time-to-first-response, recovery queue, escalations 24h, employee availability, upcoming appts, payments received; drill-down on ≥3 figures; role-aware (User sees own); show/hide figures persisted |

## Required integrations (all real, sandbox/test mode)

| ID | Service | Provider | Used for |
|---|---|---|---|
| I1 | Messaging | **Twilio WhatsApp Sandbox** (SMS acceptable) | Convo view, send/reply, delivery status, contact matching, opt-out, dedup webhooks, retries |
| I2 | Payments | **Stripe test mode** | Payment links/checkout from opportunity; webhook confirms automatically; idempotent; refunds; no card data ever stored |
| I3 | Calendar | **Google Calendar via OAuth 2.0** | Employee connects own account; book appt → real GCal event; busy-time conflicts; timezones; reschedule/cancel syncs |
| I4 | Notifications (choose ONE) | **Slack / Telegram bot / email (Resend, SendGrid, Mailgun)** | Escalation alert to new owner within same minute; per-user routing; retries + visibility |
| I5 | Cross-cutting | — | Central integrations page w/ status; per-workspace credentials; secrets server-only; sync history; retry policy; stated limits; permission+audit; failure isolation |

**Sandbox constraints to plan for:** Twilio sandbox = phones must text join phrase first; Stripe test = published test cards + per-endpoint webhook secrets; Google = testing-status app (listed test users only, short-lived refresh tokens); **all webhooks need a public HTTPS URL** (tunnel or deploy) — budget time for this.

## Quality requirements (Q1–Q14) — where skill shows

Auth security (salted hashes, expiring sessions, login throttling) · server-side authorization everywhere · input validation + injection/XSS/CSRF protection · data integrity (no orphans, no silent overwrite) · **concurrency correctness: assignment/escalation/webhook double-fire + restart-safety of timers** · real DB persistence · responsive (phone/tablet/laptop) · accessible (keyboard, labels, contrast) · performance (pagination, non-blocking) · loading/success/failure feedback on every action · **real-time updates without refresh** · consistent figures across screens · config/secrets outside code + runnable instructions · modular structure (business rules ≠ data access ≠ integrations ≠ presentation).

## Metric definitions (must be consistent in dashboards, lists, exports, audit)

- **Lead**: record from intake (web form / incoming message / manual) with source label
- **Acknowledged**: clicked Acknowledge OR did any recorded action (note, message, call log, stage change, appointment)
- **Time to first response**: first assignment → first acknowledgement
- **Escalation**: automatic reassignment from expired ack window (manual reassign counts separately)
- **Recovery queue item**: unacked beyond window, OR ≥2 escalations, OR no action for configured idle period
- **Available employee**: status=Available AND open-lead count < limit
- **Open pipeline value**: sum of opp values not in won/lost stage, grouped by stage
- **Projected revenue**: open opps + unpaid payment requests
- **Collected revenue**: webhook-confirmed payments − confirmed refunds
- **Conversation**: all messages with one contact on one channel
- **Appointment**: calendar event created from platform, linked to contact/opportunity
- **Integration event**: any inbound webhook / outbound call, logged in sync history

## Demo-critical observations (strategy notes)

1. **Timers must be demonstrable in seconds** — the statement explicitly says thresholds must be configurable so escalation can be *observed during the demo*. Configurable + persisting across restart (Q5) is a judged point.
2. **F3.8 race conditions are a spotlight requirement** — two timers expiring close together must not double-escalate. Idempotency + row locks / atomic claims needed.
3. **Real integrations are graded, hard-coded stand-ins fail** — need live webhook endpoints (tunnel/deploy), signature verification for Twilio + Stripe, public HTTPS.
4. **Field-level protection (F1.4) + workspace isolation (F1.6)** appear in acceptance criteria — classic "hidden button isn't enough" server-enforcement test; graders likely probe direct API calls and guessed IDs.
5. **Audit is tamper-proof (F4.3)** — no edit/delete endpoints at all for history rows.
6. **One complete customer page (F2.8)** is the showcase screen: conversations + opportunities + payments + appointments + assigned employee + history.
7. **No card data ever touches the platform (I2.8)** — Stripe hosted page only.
8. **Providers can fail** — every integration needs failure states visible + retry, and failure isolation (I5.8) so one dead provider doesn't kill the app.

## Hackathon meta (prize, deadline, judging)

Status: research in progress (librarian agent search launched 2026-10-18).
Will be appended here when found: hackathon name, organizer, prize amounts, submission deadline, judging criteria, submission format (repo/video/deploy).

