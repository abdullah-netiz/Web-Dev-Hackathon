# Requirements Matrix — every ID, one checklist

> Source: `problem statement.docx` (fully mapped: 31×F + 36×I + 14×Q = 81 requirements).
> Status legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` at risk.
> Per-ID boxes below are the original plan-time checklist; the roll-up at the top is current.

## Status at integration time (2026-10-18)

- **Backend — `origin/backend` (devA): [x]** implements F1–F5, I1–I5 and the Q1–Q14 backend mechanisms
  (auth/RBAC, masking, workspace isolation, audit append-only + grants, lead engine with partial unique index,
  dashboard definitions, all four providers with raw-body signature verification, inbound event idempotency,
  retries). Verified: typecheck clean, 13/13 unit tests, migrations + seed applied.
- **Frontend — `origin/taimoor` (devC): [~]** all screens built and working against the in-browser mock
  (dashboard, leads + countdown, recovery, conversations, contacts/companies, opportunities board,
  payments, appointments, audit, settings/*, public form, Stripe return). `live` mode (`src/lib/api/http.ts`)
  is a draft to be aligned with `docs/api.md` — see [`integration-checklist.md`](./integration-checklist.md).
- **Third-party integrations: [~]** provider code is complete; sandbox accounts and webhook registration on a
  public URL are still pending (Twilio sandbox join, Stripe test keys + webhook secret, Google OAuth client,
  Telegram bot + setWebhook).
- **Deployment: [ ]** Railway (api + Postgres + Redis) and Vercel (frontend) not started.
- **End-to-end verification of the integrated stack: [ ]** (see `backend/scripts/smoke/`).

## F1 — Accounts, roles, permissions (6)

- [ ] **F1.1** Sign up / log in / log out / persistent sessions — signup creates workspace + first user = Owner; refresh keeps session
- [ ] **F1.2** Three base levels Owner/Admin/User — Owner invites + assigns levels; Admin cannot modify Owner; User sees only permitted data
- [ ] **F1.3** Configurable permissions (not role-name-bound) — Owner grants/removes ≥: view, create, edit, delete, export on CRM; manage assignment rules; manage integrations; view audit log
- [ ] **F1.4** Field-level protection — opportunity value hidden/masked without permission in lists, detail pages AND exports
- [ ] **F1.5** Server-side enforcement — direct API call by unauthorized user rejected (button-hiding not sufficient)
- [ ] **F1.6** Workspace isolation — never read/change another workspace's data, even via guessed identifiers

## F2 — Customizable CRM (8)

- [ ] **F2.1** Contacts, companies, opportunities with relationships — contact ∈ company, many opportunities; contact page shows all related records
- [ ] **F2.2** Custom fields from UI — Admin adds name + type (text, number, date, dropdown, checkbox) w/o code; appears on forms/detail immediately
- [ ] **F2.3** Different fields per pipeline — two pipelines, different custom field sets, same contact info
- [ ] **F2.4** Stage-specific required fields — moving opportunity into configured stage blocked with clear message until required fields filled
- [ ] **F2.5** Customizable pipeline stages — add/rename/reorder/delete; safe delete when stage has opportunities; move between stages on board or list
- [ ] **F2.6** Filtering + saved lists — ≥3 combined criteria (field, tag, stage, owner, date); saved list auto-updates as records start/stop matching
- [ ] **F2.7** Activity history per contact & opportunity — time-ordered: notes, stage changes, assignments, field edits, messages, payments, appointments — with who + when
- [ ] **F2.8** Complete customer view — one page: conversations, opportunities, payments, appointments, assigned employee, full activity history

## F3 — Lead capture, assignment, acknowledgement, escalation (9) ⭐ CENTRAL

- [ ] **F3.1** Lead capture from multiple sources — public web form + incoming message (I1) + manual entry; each with source label
- [ ] **F3.2** Employee availability — status: Available / Busy / On leave / Offline; set by self or Admin
- [ ] **F3.3** Configurable assignment rules — round-robin among Available; max open leads/employee; non-Available never receive leads
- [ ] **F3.4** Acknowledgement window — assignee notified, must ack/act within configurable time; remaining time visible
- [ ] **F3.5** Escalation chain — on expiry → next eligible → designated backup → manager; levels count + time per level configurable
- [ ] **F3.6** Reassignment on absence — On leave/Offline immediately reassigns unacknowledged leads; treatment of acknowledged leads defined + visible
- [ ] **F3.7** Recovery queue — one page: unacked beyond window OR escalated ≥2 OR untouched for configurable period; reason shown per item
- [ ] **F3.8** No duplicate action — never owned by two people at once; two timers expiring close together never double-escalate the same lead
- [ ] **F3.9** External escalation notification — new owner alerted outside app via I4 integration

## F4 — Audit history (3)

- [ ] **F4.1** Record important actions — assignment, ack, escalation, reassignment, role/permission changes, field/pipeline config changes, integration connection changes, deletions — with actor (or system), time, target, before/after values
- [ ] **F4.2** Restricted visibility — audit permission gates access; filterable by event type, user, date
- [ ] **F4.3** Tamper resistance — no screen or endpoint can edit/delete history entries

## F5 — Operational dashboard (5)

- [ ] **F5.1** Live overview — new leads today, open pipeline value by stage, avg time-to-first-response, recovery queue count, escalations 24h, employee availability, upcoming appointments, payments received this month
- [ ] **F5.2** Consistent definitions — follows Section 7 glossary; figures match underlying records when opened
- [ ] **F5.3** Drill-down — ≥3 figures click → filtered list of records (respecting permissions)
- [ ] **F5.4** Role-aware — User sees personal figures (own leads, own response time); Owner/Admin see company-wide
- [ ] **F5.5** Basic customization — show/hide figures, choice remembered

## I1 — Messaging: Twilio WhatsApp Sandbox (9)

- [ ] **I1.1** Receive — real phone → sandbox number → provider webhook → platform conversation view
- [ ] **I1.2** Request authenticity — provider signature verified; forged/altered request rejected AND recorded
- [ ] **I1.3** Send — employee replies from platform → customer receives on phone
- [ ] **I1.4** Delivery status — sent/delivered/failed from status callbacks stored + shown per message
- [ ] **I1.5** Contact matching — known number → existing contact; unknown → creates contact + lead (links F3.1)
- [ ] **I1.6** Ownership — conversation shows assigned employee; visibility limited by permission
- [ ] **I1.7** Failure handling — rejected/unreachable send stays visible as failed with reason; retry possible; nothing silently dropped
- [ ] **I1.8** Duplicates — webhook delivered twice ≠ two messages / two leads
- [ ] **I1.9** Opt-out — opted-out contact cannot be messaged; UI explains why

## I2 — Payments: Stripe test mode (8)

- [ ] **I2.1** Create payment request from opportunity — link/checkout session for amount + currency; sendable to customer
- [ ] **I2.2** Webhook confirmation — completing test payment updates opportunity payment status with NO manual refresh, driven by provider webhook
- [ ] **I2.3** Request authenticity — webhook signature verified before any record change
- [ ] **I2.4** Idempotent — same event received twice records payment once
- [ ] **I2.5** Other outcomes — expired/abandoned/failed shown correctly; refund in provider dashboard reflected in platform
- [ ] **I2.6** Collected vs expected — distinguish collected revenue from projected/unpaid; dashboard "payments received" uses collected only
- [ ] **I2.7** Traceability — payment shows opportunity, contact, requesting employee, provider reference
- [ ] **I2.8** No card data stored — never store/log card numbers; details entered only on provider hosted page

## I3 — Calendar: Google Calendar OAuth 2.0 (7)

- [ ] **I3.1** Connect with consent — employee connects own Google account via OAuth; can disconnect
- [ ] **I3.2** Token handling — auto-refresh access tokens; server-side storage only; revoked/expired detected + shown as needing reconnection
- [ ] **I3.3** Create appointments — from opportunity/contact → appears in employee's real Google Calendar + customer record
- [ ] **I3.4** Avoid conflicts — booking screen reads busy times; prevents or warns about overlaps
- [ ] **I3.5** Time zones — displays correctly for employee; stored unambiguously across time zones
- [ ] **I3.6** Change + cancel — reschedule/cancel in platform updates Google event; recorded in activity history
- [ ] **I3.7** Availability link — connection status visible to Admins; employee without connected calendar can't be booked + sees why

## I4 — Notifications: CHOOSE ONE (Slack | Telegram bot | email) (4)

- [ ] **I4.1** Real delivery — escalation (F3.5) → new owner messaged on chosen channel within same minute
- [ ] **I4.2** Useful content — alert names lead, source, escalation reason, link that opens the lead
- [ ] **I4.3** Per-user routing — each employee configures own destination (Slack user / Telegram chat / email address)
- [ ] **I4.4** Failure handling — failed alert recorded, retried limited times, visible to Admins

## I5 — Cross-cutting integration requirements (8)

- [ ] **I5.1** Central integrations page — each integration: status (not connected/connected/error), last worked, recent errors
- [ ] **I5.2** Per-workspace config — each workspace supplies own credentials; never shared across workspaces
- [ ] **I5.3** Secret handling — keys/tokens/signing secrets never sent to browser, never in repo, never shown in full in UI
- [ ] **I5.4** Synchronization history — every inbound event + outbound call recorded: time, result, reference; reviewable by authorized users
- [ ] **I5.5** Resilience — temporary errors retried with delay; permanent errors shown with plain explanation
- [ ] **I5.6** Clearly stated limits — UI states what each integration can/cannot do (e.g., sandbox reachability)
- [ ] **I5.7** Permission + audit — only integration-permission users connect/change/remove; each change in audit log (F4.1)
- [ ] **I5.8** Isolation of failures — one provider down ≠ platform down

## Q1–Q14 — Quality requirements (14)

- [ ] **Q1** Auth security — salted hashes (recognized algorithm); sessions/tokens expire + revocable; login protected vs repeated guessing
- [ ] **Q2** Authorization — every endpoint checks workspace + permission server-side; URL identifiers can't reach others' data
- [ ] **Q3** Input safety — server-side validation; injection/XSS/CSRF protection; uploaded/imported content never trusted
- [ ] **Q4** Data integrity — deleting/changing stage, field, user, contact never orphans/contradicts; concurrent edits don't silently overwrite
- [ ] **Q5** Concurrency & timing — assignment, escalation, webhooks correct under simultaneous + duplicate events; server restart during timers safe
- [ ] **Q6** Persistence — real database; survives restart; UI config stored per workspace
- [ ] **Q7** Responsive — every screen usable on phone/tablet/laptop; no horizontal scroll or hidden controls
- [ ] **Q8** Accessibility — keyboard usable, labeled forms, color not sole meaning carrier, readable contrast
- [ ] **Q9** Performance — several hundred records load paginated; search/filters responsive; slow ops show progress
- [ ] **Q10** Feedback & errors — loading/success/failure on every action; errors say what went wrong + what to do
- [ ] **Q11** Real-time awareness — new leads/escalations/messages appear without manual refresh
- [ ] **Q12** Consistent data — same figure = same value on every screen (single source of truth)
- [ ] **Q13** Config & secrets — outside source code; new person can start app from written instructions + sample data
- [ ] **Q14** Maintainable structure — separation: business rules / data access / integrations / presentation

## Coverage summary

| Group | Count | Status |
|---|---|---|
| F1 Accounts/roles | 6 | 0% |
| F2 CRM | 8 | 0% |
| F3 Lead protection | 9 | 0% |
| F4 Audit | 3 | 0% |
| F5 Dashboard | 5 | 0% |
| I1 Messaging | 9 | 0% |
| I2 Payments | 8 | 0% |
| I3 Calendar | 7 | 0% |
| I4 Notifications | 4 | 0% |
| I5 Integration cross-cutting | 8 | 0% |
| Q1–Q14 Quality | 14 | 0% |
| **Total** | **81** | **0%** |
