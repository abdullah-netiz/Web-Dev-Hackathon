# Baton — frontend

Next.js 16 (App Router) · React 19 · Tailwind 4 · Radix · TanStack Query · react-hook-form + Zod · Motion · GSAP · Lenis.

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev            # http://localhost:3000
npm run build          # production build
```

## Modes

- `NEXT_PUBLIC_API_MODE=mock` (default): the full app runs against an in-browser mock backend
  (`src/lib/api/mock/`) with a seeded workspace, *Northwind Solar*, and a simulated lead engine (round-robin,
  ack timers, escalation next → backup → manager, absence reassignment, recovery reasons, Telegram alert records).
  Log in as `amina@northwind.test` (Owner), `sara@northwind.test` (Manager) or `bilal@northwind.test` (Sales),
  password `demo1234`. The **Demo controls** button stands in for Twilio/Stripe/form webhooks.
- `NEXT_PUBLIC_API_MODE=live`: `src/lib/api/http.ts` calls the backend. Routes there are a draft; align them with
  `docs/api.md` when the backend publishes it. Every screen uses the `Api` interface in `src/lib/api/contract.ts`,
  so only `http.ts` changes.

## Layout

```
src/app/(public)/   login, signup, invite, public lead form /f/[slug], Stripe return /pay/[result]
src/app/(app)/      dashboard, leads, recovery, conversations, contacts, companies, opportunities,
                    payments, appointments, team, audit, settings/*
src/app/page.tsx    front door (Lenis + GSAP)
src/components/     ui/ (primitives), app/ (shell, realtime), leads/, crm/, activity/, brand/, landing/
src/lib/api/        types, contract, http client, mock backend
```

See `docs/frontend-plan.md` for the route → requirement map.
