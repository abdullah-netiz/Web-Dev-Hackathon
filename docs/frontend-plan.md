# Frontend plan — Baton

Owner: Taimoor (frontend). Branch: `taimoor`. App: `frontend/` (Next.js 16 App Router, React 19, Tailwind 4,
Radix primitives, TanStack Query 5 + Table 8, react-hook-form + Zod, Motion, GSAP, Lenis).

## Brand

**Baton.** In a relay, exactly one runner holds the baton; if it is dropped, it is handed on. That is the product's
rule: every lead has exactly one accountable owner, and an ignored lead is passed to the next person automatically.

- Mark: a short horizontal bar (the baton) with a notch. When a lead escalates, the mark slides from one owner to the next.
- Palette: paper `#F7F9F8`, surface `#EBF0EE`, teal ink `#06525C`, deep ink `#0B2B30`, signal `#E4572E`
  (used only for an ack window that is running out or expired, always paired with text and an icon, Q8).
- Type: Zodiak (display, landing and auth only) and Hanken Grotesk (everything in the app, tabular figures for clocks and money).
- Motion: the hand-off. Ack windows drain as a bar; escalation slides the baton to the new owner; new leads arrive from
  the top of lists. Transform and opacity only; everything has a `prefers-reduced-motion` path.
- No gradients, glass, glows, eyebrow pills, violet, emoji, or icon-card grids (taste-skill house rules).

## Routes

| Route | Purpose | Requirements |
|---|---|---|
| `/` | Front door: what Baton guarantees, sign in, create workspace. Hero sentence with a live ack clock inside it | F1.1 |
| `/login`, `/signup`, `/invite/[token]` | Auth; sign-up creates a workspace and its Owner | F1.1, F1.2, Q1, Q10 |
| `/f/[slug]`, `/f/[slug]/sent` | Public lead form per workspace and its confirmation | F3.1, Q3, Q7, Q8 |
| `/pay/[result]` | Stripe Checkout return pages; status from the webhook, not from the redirect | I2.2, I2.5 |
| `/dashboard` | Live figures (Section 7), drill-down links, show/hide figures remembered | F5.1–F5.5, Q11, Q12 |
| `/leads`, `/leads/[id]` | Inbox with live countdown, Acknowledge, reassign; lead detail with assignment history | F3.1–F3.8 |
| `/recovery` | Overdue / escalated twice / idle, reason on each row | F3.7 |
| `/team` | Availability board, open-lead load, calendar + Telegram status per member | F3.2, F3.6, I3.7, I4.3 |
| `/contacts`, `/contacts/[id]` | Paginated list, search, multi-criteria filters, saved lists; full customer view | F2.1, F2.6, F2.7, F2.8, Q9 |
| `/companies`, `/companies/[id]` | Companies and their contacts and opportunities | F2.1 |
| `/opportunities`, `/opportunities/[id]` | Board (drag between stages) and list per pipeline; stage-required-field dialog; value masked when not permitted | F1.4, F2.3–F2.5 |
| `/conversations`, `/conversations/[id]` | WhatsApp threads, delivery status, failed + retry, opt-out explanation | I1.1–I1.9 |
| `/payments` | Requests, statuses, collected vs projected | I2.1–I2.7 |
| `/appointments` | Upcoming bookings in the viewer's time zone; booking dialog with busy-time warning | I3.3–I3.6 |
| `/audit` | Read-only history, filters by type, user, date | F4.1–F4.3 |
| `/settings/*` | workspace, members, roles (permission matrix), pipelines and stages, custom fields, assignment rules, integrations, notifications, profile | F1.2, F1.3, F2.2, F2.5, F3.3, I5 |

## Data layer

- `src/lib/api/types.ts` mirrors the PLAN §4 data model; replaced by `docs/api.md` types when the backend publishes them.
- `src/lib/api/client.ts` handles the `{ data, meta }` / `{ code, message, action }` envelope, Bearer session token, 401 → login.
- `NEXT_PUBLIC_API_MODE=mock` swaps in an in-browser mock backend with seed data and a simulated lead engine
  (timers, escalations, socket events) so every screen can be built and demoed before the API lands.
  `live` talks to `NEXT_PUBLIC_API_URL` and Socket.IO.
- Socket events invalidate TanStack Query keys (`lead:assigned`, `lead:escalated`, `lead:acknowledged`, `message:new`,
  `message:status`, `payment:updated`, `availability:changed`).

## What the frontend needs from the backend (to confirm in `docs/api.md`)

Public, no session: `GET /public/workspaces/:slug` (name, form fields), `POST /intake/:slug`,
`GET /public/payments/:sessionId` (status only).
Everything else as listed in PLAN §6 for the frontend teammate.

## Order of work

1. Scaffold, tokens, fonts, Radix base components, app shell, mock backend.
2. Auth pages, landing.
3. Leads inbox + countdown + acknowledge, recovery queue, team availability.
4. Contacts / companies / opportunities board + list, custom fields renderer.
5. Dashboard with drill-down and preferences.
6. Conversations, payments, booking dialog, integrations, audit, settings.
7. Public intake form and payment return pages.
8. 375 px pass, keyboard pass, Lighthouse a11y, reduced-motion pass.
