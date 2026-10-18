# Smoke suites

Standalone Node HTTP suites used to verify the API end-to-end against a running server
(`node dist/main.js`, then `node scripts/smoke/<suite>.mjs`). No test framework, no dependencies —
plain `fetch` + assertions, printing `PASS/FAIL` per check and a summary.

| File | Covers | Checks |
|---|---|---|
| `smoke-crm.mjs` | auth, workspaces, companies, contacts, opportunities, pipelines, custom fields, activities | 34 |
| `smoke-leads.mjs` | public intake form, assignment, ack window, escalation, recovery, reassign, realtime hooks | 38 |
| `smoke-dashboard.mjs` | role-aware dashboard widgets, drill-downs, saved prefs | 22 |
| `smoke-workspaces.mjs` | signup, workspace settings, members, roles | 42 |
| `smoke-realtime.mjs` | Socket.IO handshake, rooms, events | 15 |

Total: **151 assertions**.

They were written against the `feat/backend-scaffold` contract. The canonical backend is `origin/backend`
(`docs/api.md`), whose paths differ in places (e.g. keyset pagination, `GET /auth/ws-token`, payment requests
under `/opportunities/:id/payment-requests`) — port the paths/shapes before using them there.
Seed credentials in the scripts: `owner@demo.test` / `Password123!`.
