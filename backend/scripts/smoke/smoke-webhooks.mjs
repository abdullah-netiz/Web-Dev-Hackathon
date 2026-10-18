#!/usr/bin/env node
// Signed-webhook regression suite (I1.2, I1.5, I1.8, I2.2–I2.5, I5.4).
// Signs requests exactly as Twilio and Lemon Squeezy do, using the credentials you pass, so the
// verification, idempotency and status logic can be checked without a phone or a real checkout.
//
//   API_URL=http://localhost:4000 EMAIL=owner@demo.test PASSWORD=Demo1234! \
//   TWILIO_AUTH_TOKEN=<token connected in the app> LS_WEBHOOK_SECRET=<secret connected in the app> \
//   [PAYMENT_ID=<a PENDING payment id>] node scripts/smoke/smoke-webhooks.mjs
//
// It never changes the connected credentials. Real provider traffic still has to be shown live for the judges.
import { createHmac } from 'node:crypto';

const API = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const PUBLIC = (process.env.PUBLIC_URL ?? API).replace(/\/$/, '');
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.EMAIL ?? 'owner@demo.test', password: process.env.PASSWORD ?? 'Demo1234!' }) }).then((r) => r.json());
const token = login.data.token;
const auth = { authorization: `Bearer ${token}` };
const me = await fetch(`${API}/auth/me`, { headers: auth }).then((r) => r.json());
const workspaceId = me.data.workspace.id;

// ── Twilio ──
if (process.env.TWILIO_AUTH_TOKEN) {
  const path = `/webhooks/twilio/${workspaceId}`;
  const sid = `SM${Date.now().toString(16).padStart(32, '0')}`;
  const phone = `+92300${String(Date.now()).slice(-7)}`;
  const params = { MessageSid: sid, AccountSid: 'ACtest', From: `whatsapp:${phone}`, To: 'whatsapp:+14155238886', Body: 'Hi, I need a quote for solar panels', NumMedia: '0', ProfileName: 'Smoke Tester' };
  const sign = (p) => createHmac('sha1', process.env.TWILIO_AUTH_TOKEN).update(PUBLIC + path + Object.keys(p).sort().map((k) => k + p[k]).join('')).digest('base64');
  const send = (p, signature) => fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature }, body: new URLSearchParams(p).toString() });

  const forged = await send({ ...params, Body: 'tampered' }, sign(params));
  check('Twilio: altered body with old signature is rejected', forged.status === 403, `HTTP ${forged.status}`);
  const first = await send(params, sign(params));
  check('Twilio: correctly signed message is accepted', first.status === 200, `HTTP ${first.status}`);
  const again = await send(params, sign(params));
  check('Twilio: the same delivery repeated is accepted (2xx) …', again.status === 200);
  await new Promise((r) => setTimeout(r, 2500));
  const convs = await fetch(`${API}/conversations?limit=100`, { headers: auth }).then((r) => r.json());
  const conv = convs.data.find((c) => c.externalAddress === `whatsapp:${phone}`);
  check('Twilio: unknown number created a contact and a conversation', Boolean(conv));
  if (conv) {
    const msgs = await fetch(`${API}/conversations/${conv.id}/messages`, { headers: auth }).then((r) => r.json());
    check('… and stored the message exactly once', msgs.data.filter((m) => m.providerSid === sid).length === 1, `${msgs.data.length} message(s)`);
    const leads = await fetch(`${API}/leads?limit=100`, { headers: auth }).then((r) => r.json());
    check('… and created exactly one lead from the message', leads.data.filter((l) => l.contactId === conv.contactId).length === 1);
  }
  const events = await fetch(`${API}/integrations/events?provider=TWILIO&limit=20`, { headers: auth }).then((r) => r.json());
  check('Twilio: forged request is listed in the sync history', events.data.some((e) => e.status === 'REJECTED'));
}

// ── Lemon Squeezy ──
if (process.env.LS_WEBHOOK_SECRET) {
  const path = `/webhooks/lemonsqueezy/${workspaceId}`;
  const send = (payload, secret = process.env.LS_WEBHOOK_SECRET) => {
    const body = JSON.stringify(payload);
    return fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': createHmac('sha256', secret).update(body).digest('hex') }, body });
  };
  const paymentId = process.env.PAYMENT_ID;
  const order = (event, attributes) => ({ meta: { event_name: event, test_mode: true, custom_data: paymentId ? { payment_id: paymentId, workspace_id: workspaceId } : {} }, data: { type: 'orders', id: '900001', attributes: { status: 'paid', total: 5000, refunded_amount: 0, created_at: new Date().toISOString(), updated_at: '2026-10-18T10:00:00Z', ...attributes } } });

  const bad = await send(order('order_created', {}), 'wrong-secret');
  check('Lemon Squeezy: webhook signed with the wrong secret is rejected', bad.status === 400, `HTTP ${bad.status}`);
  if (paymentId) {
    const ok = await send(order('order_created', {}));
    const dup = await send(order('order_created', {}));
    const dupBody = await dup.json();
    check('Lemon Squeezy: paid order accepted', ok.status === 200);
    check('Lemon Squeezy: repeated delivery is recognised as a duplicate', (dupBody.duplicate ?? dupBody.data?.duplicate) === true);
    await new Promise((r) => setTimeout(r, 2000));
    let payment = await fetch(`${API}/payments/${paymentId}`, { headers: auth }).then((r) => r.json());
    check('Lemon Squeezy: payment is PAID', payment.data.status === 'PAID', payment.data.status);
    await send(order('order_refunded', { status: 'refunded', refunded_amount: Math.round(Number(payment.data.amount) * 100), updated_at: '2026-10-18T10:05:00Z' }));
    await new Promise((r) => setTimeout(r, 2000));
    payment = await fetch(`${API}/payments/${paymentId}`, { headers: auth }).then((r) => r.json());
    check('Lemon Squeezy: refund made in the dashboard shows as REFUNDED', payment.data.status === 'REFUNDED', payment.data.status);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
