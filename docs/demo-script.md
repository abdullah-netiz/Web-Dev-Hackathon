# Demo script (about 10 minutes)

Before you start: seeded workspace, open the app as `owner@demo.test` (password `Demo1234!`) in one
window and `support@demo.test` in a private window. In **Settings → Assignment rules** set the first
window to **30 s** and the level window to **30 s**. Have a phone that has joined the Twilio sandbox.

1. **Security (criterion 1)** — Settings → Roles: grant Support "View audit history" and show it saved.
   In the Support window, open Opportunities: values say *Hidden*. Try `GET /opportunities` with the
   Support token to show `value: null`. Mention the 404 for other workspaces.
2. **CRM (2)** — Settings → Custom fields: add a dropdown on *Solar installations* only. Open a Sales
   opportunity and move it to *Negotiation*: the dialog asks for *Decision date*. Contacts: filter by
   owner + tag + "added since", save as a list.
3. **Lead engine (3)** — Open Leads. From the phone (or `/f/demo`) send a lead. It appears with a
   countdown; wait 30 s: it escalates once, the new owner gets a toast and a Slack DM with a link.
   Acknowledge it. Set the next assignee *On leave*: their waiting lead moves at once. Show the
   Recovery queue reasons.
4. **Audit and dashboard (4)** — Audit history filtered by *Lead escalated*. Dashboard: figures changed
   live; click one to open the matching list. Show the Support dashboard is personal.
5. **Messaging (5)** — Reply from Conversations; the phone receives it and the status turns Delivered.
   Show Settings → Integrations → Sync history with the rejected forged request from
   `scripts/smoke/smoke-webhooks.mjs`.
6. **Payments (6)** — On an opportunity: Request payment, open the link, pay with `4242 4242 4242 4242`.
   The status turns Paid without refresh and *Collected this month* rises. Refund in the Lemon Squeezy
   dashboard and show *Refunded*.
7. **Calendar (7)** — Settings → Profile → Connect Google. Book an appointment over a busy slot to see
   the clash warning, then a free slot; show it in Google Calendar. Cancel it.
8. **Quality (9)** — Shrink the window to phone width; restart the API and show data and timers are back;
   disconnect one integration and show everything else still works.
