# Self-check against the Participant Rubric

Honest status of the integrated product (branch `integration`), checked on 2026-10-18 by running the
real backend (Postgres + Redis) and the production frontend build together. **Legend:**
✅ verified end to end in the running app · 🔌 code complete and verified with correctly signed test
requests, but needs the team's real provider account to show live · ⚠️ known limitation.

Tick a box on the judges' form only after you have shown it on the deployed URL.

## 1. Roles, permissions and security — 10 pts

| Check | Status | How to show it |
|---|---|---|
| Roles and permissions changed in the interface | ✅ | Settings → Roles: toggle "View audit history" for Support; it saves and is audited |
| Hidden data stays hidden through the API | ✅ | Log in as `support@demo.test`: opportunity values show "Hidden"; `GET /opportunities` returns `value: null`; CSV export is refused (403) |
| Server refuses what the UI hides | ✅ | As Support, `PATCH /roles/:id` → 403 `PERMISSION_DENIED` with a plain reason |
| One workspace cannot see another | ✅ | Sign up a second company; requesting a contact id from the first returns 404 |
| Login protected against guessing | ✅ | 6th wrong password within a minute → 429 |

## 2. Customizable CRM — 12 pts

| Check | Status | How to show it |
|---|---|---|
| Custom fields from the UI | ✅ | Settings → Custom fields → New field (text, number, date, dropdown, checkbox); appears on forms at once |
| Per-pipeline fields | ✅ | Seed has *Sales pipeline* and *Solar installations*; "System size (kW)" and "Roof type" belong to Solar only |
| Required fields by stage | ✅ | Move a Sales opportunity to *Negotiation*: blocked, dialog asks for *Decision date*, then moves |
| Editable pipeline | ✅ | Settings → Pipelines: add, rename, reorder, delete (deleting a stage with deals asks where to move them) |
| Saved lists | ✅ | Contacts: combine owner + tag + date filters, save; the list updates as records change |

## 3. Lead assignment and escalation — 14 pts

| Check | Status | How to show it |
|---|---|---|
| Leads only to available staff | ✅ | Set someone Busy; new leads skip them (round-robin among Available under their limit) |
| Countdown visible | ✅ | Leads page and lead detail show the live clock |
| Expired lead escalates once | ✅ | Ack window 25 s: lead moved Maria → Olivia once; toast "Escalated to you"; chain shown on the lead |
| Absence reassigns at once | ✅ | Set the assignee On leave: their waiting leads move immediately (verified Maria → Sam) |
| Recovery queue shows why | ✅ | Recovery page lists Overdue / Escalated twice / Idle with the reason per lead |
| Survives a restart | ✅ | Pending timers are re-queued from the database on startup |

## 4. Audit log and dashboard — 8 pts

| Check | Status | How to show it |
|---|---|---|
| Key actions logged | ✅ | Audit history: assignments, escalations, role changes, field/pipeline changes, integration changes, deletions |
| Cannot be edited | ✅ | No edit/delete in UI or API; the database role has UPDATE/DELETE revoked when `ubmp_app` is used |
| Dashboard live and matching records | ✅ | New lead and escalation update the figures without refresh; each figure opens the matching list |
| Differs by role | ✅ | Owner sees company figures; Support sees personal figures and no amounts |

## 5. Messaging (Twilio WhatsApp) — 12 pts

| Check | Status | How to show it |
|---|---|---|
| Real phone message arrives | 🔌 | Needs Twilio sandbox + joined phone. Verified with signed requests: unknown number → contact + conversation + lead |
| Reply delivered | 🔌 | Needs Twilio. Sending path and status callbacks implemented |
| Forged / repeated webhooks handled | ✅ | `scripts/smoke/smoke-webhooks.mjs`: altered body → 403 and listed as Rejected; repeat → stored once |
| Failures visible and retryable | ✅ | With bad credentials the reply shows *Failed* with Twilio's reason and a Retry button |

## 6. Payments (Lemon Squeezy, test mode) — 12 pts

| Check | Status | How to show it |
|---|---|---|
| Real test payment updates the record | 🔌 | Needs a Lemon Squeezy test store. Verified with signed webhooks: PENDING → PAID without refresh |
| Webhooks verified, not double-counted | ✅ | Wrong secret → 400; same event twice → recorded once (`duplicate: true`) |
| Refunds and failures show | ✅/⚠️ | Refund webhook → REFUNDED. Unpaid links turn EXPIRED after their deadline. Lemon Squeezy does not report declined cards, so FAILED appears only when the checkout cannot be created |

## 7. Calendar (Google) — 10 pts

| Check | Status | How to show it |
|---|---|---|
| Google sign-in works | 🔌 | Needs the OAuth client and test users. Consent flow, encrypted refresh token, reconnect state implemented |
| Appointments in the real calendar | 🔌 | Book from a contact or opportunity; creates the Google event |
| Clashes detected | 🔌 | Booking reads Google FreeBusy plus booked appointments; overlap returns a warning |
| Time zones correct | 🔌 | Stored in UTC with the booking's IANA zone; sent to Google with the zone |

## 8. Notifications (Slack) — 4 pts

| Check | Status | How to show it |
|---|---|---|
| Escalation sends a real alert with a working link | 🔌 | Needs a Slack bot token. Alert names lead, source, reason and links to `APP_URL/leads/<id>`; failures listed under Integrations |

## 9. Quality — 10 pts

| Check | Status | Notes |
|---|---|---|
| Works on a phone | ✅ | Every main screen measured at 375 px: no horizontal page scroll (wide tables scroll inside their box) |
| Clear errors | ✅ | Every error has a reason and an action; validation lists the fields |
| No secrets in code | ✅ | Only `.env.example` files are tracked; provider keys are stored encrypted per workspace and shown masked |
| Data survives a restart | ✅ | Postgres for data, Redis with reconciliation for timers |
| One failing provider does not break the rest | ✅ | Provider calls run in queues; a failure marks that integration *Error* and nothing else |

## 10. Demo and understanding — 8 pts

- Follow `docs/demo-script.md`; it uses the seeded data and short timers.
- Each member should be able to explain their part: devA backend core and integrations, devB backend
  smoke suites and requirement matrix, devC frontend.

## Known limitations (say them if asked)

- ⚠️ The four providers have not been exercised with the team's real accounts in this check; do that on the deployed URL before judging.
- ⚠️ Free Render sleeps when idle; wake it before the demo.
- ⚠️ devB's HTTP smoke suites (`smoke-crm`, `smoke-leads`, …) were written for devB's API and are not yet ported; `smoke-webhooks.mjs` targets the integrated API.
