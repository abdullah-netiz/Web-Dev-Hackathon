// Minimal Socket.IO v4 client over a raw WebSocket so the gateway can be tested
// without pulling in socket.io-client. Exercises Engine.IO open -> "40" connect -> "42" events.
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4000';
const WS_URL = BASE.replace('http', 'ws') + '/socket.io/?EIO=4&transport=websocket';
const WebSocketImpl = globalThis.WebSocket ?? (await import('ws')).default;
const RUN = Date.now();
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
const login = async (email) => (await req('POST', '/auth/login', { body: { email, password: 'Password123!' } })).json.data.token;

function openSocket(token, timeout = 5000) {
  return new Promise((resolve) => {
    const state = { events: [], connected: false, closed: false, socket: null };
    const socket = new WebSocketImpl(WS_URL);
    state.socket = socket;
    const done = () => resolve(state);
    socket.addEventListener('open', () => {});
    socket.addEventListener('message', (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString();
      if (data.startsWith('0')) {
        socket.send('40' + (token ? JSON.stringify({ token }) : ''));
      } else if (data.startsWith('40')) {
        state.connected = true;
        done();
      } else if (data.startsWith('42')) {
        try {
          state.events.push(JSON.parse(data.slice(2)));
        } catch {}
      } else if (data === '2') {
        socket.send('3');
      }
    });
    socket.addEventListener('close', () => {
      state.closed = true;
      done();
    });
    socket.addEventListener('error', () => {});
    setTimeout(done, timeout);
  });
}
const waitFor = (state, event, ms = 8000) =>
  new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const hit = state.events.find((e) => e[0] === event);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return resolve(null);
      setTimeout(tick, 100);
    };
    tick();
  });
const eventsNamed = (state, event) => state.events.filter((e) => e[0] === event).map((e) => e[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ownerToken = await login('owner@demo.test');
const salesToken = await login('sales@demo.test');

// ---------- handshake auth ----------
const ownerSocket = await openSocket(ownerToken);
check('authenticated socket connects', ownerSocket.connected === true, JSON.stringify({ connected: ownerSocket.connected, closed: ownerSocket.closed }));
const anonSocket = await openSocket(null);
await sleep(900);
check('socket without a token is rejected', anonSocket.closed === true, JSON.stringify({ connected: anonSocket.connected, closed: anonSocket.closed }));
const badSocket = await openSocket('not-a-real-token');
await sleep(900);
check('socket with a bogus token is rejected', badSocket.closed === true, JSON.stringify({ connected: badSocket.connected, closed: badSocket.closed }));

const salesSocket = await openSocket(salesToken);
check('second member of the same workspace connects', salesSocket.connected === true);

// ---------- F1.6 room isolation ----------
const signup = await req('POST', '/auth/signup', {
  body: { workspaceName: `RT Co ${RUN}`, name: 'Rt Owner', email: `rt.${RUN}@x.test`, password: 'Password123!' },
});
const otherToken = signup.json?.data?.token;
const otherSocket = await openSocket(otherToken);
const otherLead = await req('POST', '/leads', { token: otherToken, body: { name: 'Other-workspace lead', source: 'MANUAL', phone: '+19998887777' } });
check('other workspace created a lead', otherLead.status === 201, String(otherLead.status));
await waitFor(otherSocket, 'lead.created', 4000);
check('other-workspace socket receives its own lead', eventsNamed(otherSocket, 'lead.created').some((e) => e.id === otherLead.json?.data?.id));
check('demo sockets never see another workspace\'s lead', !eventsNamed(ownerSocket, 'lead.created').some((e) => e?.id === otherLead.json?.data?.id));

// ---------- live lead events in the workspace room ----------
const created = await req('POST', '/leads', { token: ownerToken, body: { name: `Realtime Lead ${RUN}`, source: 'CALL', phone: '+10000000000' } });
const leadId = created.json?.data?.id;
check('lead created via API', created.status === 201 && !!leadId, JSON.stringify(created.json).slice(0, 160));

const ownerCreated = await waitFor(ownerSocket, 'lead.created');
check('owner receives lead.created live', ownerCreated?.[1]?.id === leadId, JSON.stringify(ownerCreated));
check('lead.created payload carries source/status/at', ownerCreated?.[1]?.source === 'CALL' && !!ownerCreated?.[1]?.at, JSON.stringify(ownerCreated?.[1]));
const salesCreated = await waitFor(salesSocket, 'lead.created');
check('other member of the workspace also receives lead.created', salesCreated?.[1]?.id === leadId);

// ---------- assignment + acknowledgement events ----------
const salesMe = await req('GET', '/auth/me', { token: salesToken });
const assign = await req('POST', `/leads/${leadId}/assign`, { token: ownerToken, body: { ownerId: salesMe.json.data.id } });
check('assign returns 200', assign.status === 200, String(assign.status));
const assignedEvent = await waitFor(ownerSocket, 'lead.assigned');
check('lead.assigned emitted with the new owner', assignedEvent?.[1]?.ownerId === salesMe.json.data.id, JSON.stringify(assignedEvent));

const ack = await req('POST', `/leads/${leadId}/acknowledge`, { token: salesToken });
check('acknowledge returns 200', ack.status === 200, String(ack.status));
const ackEvent = await waitFor(ownerSocket, 'lead.acknowledged');
check('lead.acknowledged emitted', ackEvent?.[1]?.id === leadId, JSON.stringify(ackEvent));

for (const s of [ownerSocket, salesSocket, otherSocket]) s.socket?.close();
console.log(`\n=== REALTIME SMOKE RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
