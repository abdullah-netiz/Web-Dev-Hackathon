# Deployment: Supabase + Render + Vercel

Every service here works from Pakistan. The API runs on Render with a Render Key Value (Redis), the
database is Supabase Postgres, and the frontend is on Vercel. Do the steps in order: later steps need
values from earlier ones.

## 1. Collect the values

| Value | Where it comes from |
|---|---|
| `DATABASE_URL` | Supabase → **Connect** → **Session pooler** URI (not "Direct"; Render cannot reach that). Replace `[YOUR-PASSWORD]`; use a password with letters and digits only. Append `?connection_limit=5`. |
| `APP_ENCRYPTION_KEY` | Run `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` once and keep the output. Never change it after launch: it decrypts stored provider keys. |
| `PUBLIC_URL` | The API's Render URL, e.g. `https://baton-api.onrender.com` (no trailing slash). |
| `APP_URL`, `CORS_ORIGINS` | The Vercel URL, e.g. `https://baton.vercel.app`. Use a placeholder until step 4, then update. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud → new project → enable **Google Calendar API** → **OAuth consent screen** (External, add every tester under *Test users*) → **Credentials → OAuth client ID → Web application** with redirect URI `https://<render-url>/calendar/google/callback`. |
| `SLACK_BOT_TOKEN` (optional) | api.slack.com/apps → Create app → *OAuth & Permissions* → bot scopes `chat:write`, `users:read`, `users:read.email` → Install → copy the `xoxb-` token. A workspace can also paste its own token on the Integrations page instead. |

## 2. API on Render

Option A, Blueprint: **New → Blueprint**, pick the repository; `render.yaml` creates the API and the
Redis (`noeviction`). Fill the variables it asks for with the values above.

Option B, by hand:
1. **New → Key Value**, free, *Maxmemory policy* **noeviction**. Copy the *Internal* URL as `REDIS_URL`.
2. **New → Web Service** from the repo:

| Setting | Value |
|---|---|
| Root directory | `backend` |
| Language | Node |
| Build command | `npx --yes pnpm@10 install --frozen-lockfile --prod=false && npx prisma generate && npx --yes pnpm@10 build` |
| Start command | `npx prisma migrate deploy && node dist/main.js` |
| Health check path | `/health` |
| Environment | `NODE_ENV=production` plus every value from step 1 and `REDIS_URL` |

Deploy and open `https://<render-url>/health`: it returns `"ok": true`. The first start creates all tables.

## 3. Demo data (optional)

From your machine, in `backend/`: `DATABASE_URL="<Supabase URL>" npx --yes pnpm@10 seed`. It creates
the workspace `demo` with logins `owner@demo.test`, `admin@demo.test`, `manager@demo.test`,
`sales1@demo.test`, `sales2@demo.test`, `support@demo.test`, all with password `Demo1234!`.

## 4. Frontend on Vercel

1. Import the repo, **Root Directory** `frontend`, framework Next.js (detected).
2. Environment variable `NEXT_PUBLIC_API_URL` = the Render URL. Leave `NEXT_PUBLIC_API_MODE` unset (live).
3. Deploy, then set `APP_URL` and `CORS_ORIGINS` on Render to the Vercel URL (Render redeploys).

## 5. Connect the providers (in the app, as Owner or Admin)

Open **Settings → Integrations**. Each card shows the exact webhook URL for your workspace and a
**Test connection** button that reports the provider's own error in plain language.

**Twilio WhatsApp sandbox**
1. console.twilio.com → copy **Account SID** and **Auth Token**.
2. *Messaging → Try it out → Send a WhatsApp message*: note the sandbox number (`whatsapp:+14155238886`) and join phrase; every demo phone must send the join phrase first (it expires after 3 days).
3. *Sandbox settings* → **When a message comes in** = the Twilio webhook URL from the card (POST).
4. In the app: Connect Twilio with SID, token and `whatsapp:+14155238886`.

**Lemon Squeezy (payments, test mode)**
1. Sign up at lemonsqueezy.com and create a store (it starts in test mode). The store currency is the payment currency.
2. *Products → New product* (any price; each request overrides it). Open its variant and copy the **variant ID**; copy the **store ID** from *Settings → Stores*.
3. *Settings → API* → create an **API key**.
4. *Settings → Webhooks* → add the Lemon Squeezy webhook URL from the card, choose a **signing secret**, tick `order_created` and `order_refunded`.
5. In the app: Connect Lemon Squeezy with API key, store ID, variant ID, signing secret and currency. Test card: `4242 4242 4242 4242`, any future date, any CVC.

**Slack alerts** — if `SLACK_BOT_TOKEN` is set on Render it is used for every workspace; otherwise paste
the bot token on the Slack card. Employees whose Slack email matches their app email are reached
automatically; others link their member ID in **Settings → Profile**.

**Google Calendar** — nothing to paste: each employee clicks **Connect Google** in **Settings → Profile**.

## 6. Before the demo

- The free Render service sleeps after 15 minutes idle; open the site a minute before presenting.
- Free Render Key Value keeps data in memory only; after a restart the API re-queues every pending
  acknowledgement timer from the database (startup reconciliation), so nothing is lost.
- Set short timers in **Settings → Assignment rules** (e.g. 30 s) so escalation is visible live.
