const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4000';
const RUN = Date.now().toString(36);
let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    console.log('FAIL', name, extra);
  }
}
async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}
const login = async (email) =>
  (await req('POST', '/auth/login', { body: { email, password: 'Password123!' } })).json.data.token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const owner = await login('owner@demo.test');
const sales = await login('sales@demo.test');
check('owner + sales login', !!owner && !!sales);

const users = (await req('GET', '/users', { token: owner })).json.data;
const admin = users.find((u) => u.email === 'admin@demo.test');
const salesRow = users.find((u) => u.email === 'sales@demo.test');
check('seed users found', !!admin && !!salesRow);

// --- settings ---
const settings0 = await req('GET', '/leads/settings', { token: owner });
check('GET /leads/settings 200', settings0.status === 200 && !!settings0.json.data.version, JSON.stringify(settings0.json));
const setRes = await req('PATCH', '/leads/settings', { token: owner, body: { ackWindowSec: 30, escalationLevels: 3, version: settings0.json.data.version } });
check('PATCH /leads/settings 200', setRes.status === 200 && setRes.json.data.ackWindowSec === 30, JSON.stringify(setRes.json));
check('stale settings PATCH 409', (await req('PATCH', '/leads/settings', { token: owner, body: { maxOpenLeads: 7, version: settings0.json.data.version } })).status === 409);
check('sales PATCH settings 403 (workspace.manage)', (await req('PATCH', '/leads/settings', { token: sales, body: { maxOpenLeads: 7, version: 1 } })).status === 403);

// --- F3.1 public intake + F3.3 round-robin ---
const intakes = [];
for (const label of ['A', 'B', 'C']) {
  const r = await req('POST', '/public/leads?workspace=demo', { body: { name: `Smoke Lead ${label} ${RUN}`, phone: `+9200${Math.floor(Math.random() * 1e7)}` } });
  check(`public intake 201 (${label})`, r.status === 201 && r.json.data.source === 'WEB_FORM', JSON.stringify(r.json));
  intakes.push(r.json?.data);
}
check('intake auto-assigns owners', intakes.every((l) => !!l.ownerId), JSON.stringify(intakes.map((l) => l.ownerId)));
check('round-robin spread >=2 owners', new Set(intakes.map((l) => l.ownerId)).size >= 2, JSON.stringify(intakes.map((l) => l.ownerId)));
check('intake without contact info 400', (await req('POST', '/public/leads?workspace=demo', { body: { name: 'No contact' } })).status === 400);
check('intake unknown workspace 404', (await req('POST', '/public/leads?workspace=nope', { body: { name: 'X', phone: '123' } })).status === 404);

// --- F3.4 acknowledgement, with a lead explicitly owned by admin ---
const permLead = await req('POST', '/leads', { token: owner, body: { name: `Smoke Ack ${RUN}`, phone: '+92009000001', ownerId: admin.id } });
check('create with explicit owner 201', permLead.status === 201 && permLead.json.data.ownerId === admin.id, JSON.stringify(permLead.json?.data?.ownerId));
const permLeadId = permLead.json?.data?.id;
check('non-owner without reassign cannot acknowledge 403', (await req('POST', `/leads/${permLeadId}/acknowledge`, { token: sales })).status === 403);
const ackByOwner = await req('POST', `/leads/${permLeadId}/acknowledge`, { token: owner });
check('owner (reassign) acknowledges 200', ackByOwner.status === 200, JSON.stringify(ackByOwner.json));
check('status ACKNOWLEDGED', ackByOwner.json?.data?.status === 'ACKNOWLEDGED', JSON.stringify(ackByOwner.json?.data?.status));
check('timeToFirstResponseSec recorded', typeof ackByOwner.json?.data?.timeToFirstResponseSec === 'number');
check('double acknowledge 409', (await req('POST', `/leads/${permLeadId}/acknowledge`, { token: owner })).status === 409);

// --- F3.8 ack cancels the timer: ack this lead NOW, assert after the shared wait ---
const cancelLead = intakes[2];
const cancelAck = await req('POST', `/leads/${cancelLead.id}/acknowledge`, { token: owner });
check('cancel-case lead acknowledged', cancelAck.status === 200, JSON.stringify(cancelAck.json));

// --- F3.5 escalation through the real BullMQ timer ---
const escalLead = intakes[1];
const before = await req('GET', `/leads/${escalLead.id}`, { token: owner });
const beforeOwner = before.json?.data?.ownerId;
console.log('... waiting 36s for the ack window to expire');
await sleep(36_000);
const after = (await req('GET', `/leads/${escalLead.id}`, { token: owner })).json?.data ?? {};
const pendingNow = (after.assignments ?? []).filter((a) => a.status === 'PENDING');
const expiredNow = (after.assignments ?? []).filter((a) => a.status === 'EXPIRED');
check('escalationCount incremented', after.escalationCount >= 1, JSON.stringify(after.escalationCount));
check('lead moved to a new owner', !!after.ownerId && after.ownerId !== beforeOwner, `${beforeOwner} -> ${after.ownerId}`);
check('exactly one PENDING assignment (F3.8)', pendingNow.length === 1, JSON.stringify(pendingNow.map((a) => a.level)));
check('previous assignment EXPIRED', expiredNow.length >= 1, JSON.stringify(expiredNow.map((a) => a.level)));
check('new PENDING is level 2', pendingNow[0]?.level === 2, JSON.stringify(pendingNow[0]?.level));
const afterCancel = (await req('GET', `/leads/${cancelLead.id}`, { token: owner })).json?.data ?? {};
check('acknowledged lead did not escalate', (afterCancel.escalationCount ?? -1) === 0, JSON.stringify(afterCancel.escalationCount));

// --- F3.2/F3.3 unavailable members never receive leads ---
await req('PATCH', `/users/${salesRow.id}/availability`, { token: sales, body: { availability: 'ON_LEAVE' } });
const afterLeave = await req('POST', '/public/leads?workspace=demo', { body: { name: `Smoke Leave ${RUN}`, phone: '+92007770000' } });
check('on-leave member receives no new lead', afterLeave.json?.data?.ownerId !== salesRow.id, JSON.stringify(afterLeave.json?.data?.ownerId));
await req('PATCH', `/users/${salesRow.id}/availability`, { token: sales, body: { availability: 'AVAILABLE' } });
check('restore sales available', (await req('GET', '/users?availability=AVAILABLE', { token: owner })).json.data.some((u) => u.id === salesRow.id));

// --- F3.7 recovery queue ---
const recovery = await req('GET', '/leads/recovery', { token: owner });
check('GET /leads/recovery 200', recovery.status === 200 && Array.isArray(recovery.json.data), JSON.stringify(recovery.json).slice(0, 160));
check('every recovery lead has a valid reason', (recovery.json?.data ?? []).every((l) => ['OVERDUE', 'ESCALATED_TWICE', 'IDLE'].includes(l.recoveryReason)));
check('recovery surfaces at least one lead', (recovery.json?.data ?? []).length >= 1);

// --- manual reassignment (F3.3) ---
const manual = await req('POST', `/leads/${cancelLead.id}/assign`, { token: owner, body: { ownerId: admin.id } });
check('manual assign 200 + owner changed to admin', manual.status === 200 && manual.json.data.ownerId === admin.id, `${manual.json?.data?.ownerId} vs ${admin.id}`);
check('sales cannot reassign 403 (leads.reassign)', (await req('POST', `/leads/${cancelLead.id}/assign`, { token: sales, body: { ownerId: admin.id } })).status === 403);

// --- audit trail for the engine ---
const actions = new Set(((await req('GET', '/audit?limit=100', { token: owner })).json?.data ?? []).map((e) => e.action));
for (const action of ['lead.created', 'lead.assigned', 'lead.escalated', 'lead.acknowledged', 'lead.reassigned']) {
  check(`audit has ${action}`, actions.has(action), JSON.stringify([...actions]));
}

// --- cleanup ---
const allLeads = (await req('GET', '/leads?limit=100', { token: owner })).json?.data ?? [];
let closed = 0;
for (const lead of allLeads) {
  if (lead.name?.startsWith('Smoke ')) {
    const r = await req('POST', `/leads/${lead.id}/close`, { token: owner });
    if (r.status === 200) closed++;
  }
}
console.log(`cleaned up ${closed} smoke lead(s)`);

// restore the ack window so the demo keeps its 120s default
const settingsNow = await req('GET', '/leads/settings', { token: owner });
await req('PATCH', '/leads/settings', { token: owner, body: { ackWindowSec: 120, version: settingsNow.json.data.version } });
console.log('restored ackWindowSec=120');
console.log(`\n=== LEAD SMOKE RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
