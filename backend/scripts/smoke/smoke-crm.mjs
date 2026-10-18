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
async function login(email) {
  const r = await req('POST', '/auth/login', { body: { email, password: 'Password123!' } });
  return r.json.data.token;
}

const owner = await login('owner@demo.test');
const sales = await login('sales@demo.test');
check('owner login', !!owner);
check('sales login', !!sales);

// --- Pipelines ---
const seeded = await req('GET', '/pipelines', { token: owner });
check('GET /pipelines lists seed', seeded.status === 200 && seeded.json.data.length >= 1, JSON.stringify(seeded.json));

const created = await req('POST', '/pipelines', { token: owner, body: { name: `Smoke Pipeline ${RUN}` } });
check('POST /pipelines 201', created.status === 201 && !!created.json.data.id, JSON.stringify(created.json));
const pid = created.json?.data?.id;

const stageA = await req('POST', `/pipelines/${pid}/stages`, { token: owner, body: { name: 'A' } });
const stageB = await req('POST', `/pipelines/${pid}/stages`, { token: owner, body: { name: 'B' } });
check('POST stage A 201', stageA.status === 201 && !!stageA.json.data.id, JSON.stringify(stageA.json));
check('POST stage B 201', stageB.status === 201 && !!stageB.json.data.id, JSON.stringify(stageB.json));
const a = stageA.json?.data?.id;
const b = stageB.json?.data?.id;

const reordered = await req('POST', `/pipelines/${pid}/stages/reorder`, { token: owner, body: { stageIds: [b, a] } });
check('POST reorder stages 200', reordered.status === 200, JSON.stringify(reordered.json));
const afterReorder = await req('GET', `/pipelines/${pid}`, { token: owner });
const stageOrder = afterReorder.json?.data?.stages?.map((s) => s.id);
check('reorder persisted (B before A)', Array.isArray(stageOrder) && stageOrder[0] === b && stageOrder[1] === a, JSON.stringify(stageOrder));

const opp = await req('POST', '/opportunities', { token: owner, body: { name: `Smoke Opp ${RUN}`, pipelineId: pid, stageId: a, value: 4242 } });
check('POST opportunity in stage A 201', opp.status === 201 && !!opp.json.data.id, JSON.stringify(opp.json));
const oppId = opp.json?.data?.id;

const delStage = await req('DELETE', `/pipelines/${pid}/stages/${a}?moveToStageId=${b}`, { token: owner });
check('DELETE stage with moveToStageId 200', delStage.status === 200, JSON.stringify(delStage.json));
check('moveToStageId moved >=1 opp', (delStage.json?.data?.movedOpportunities ?? 0) >= 1, JSON.stringify(delStage.json));
const movedOpp = await req('GET', `/opportunities/${oppId}`, { token: owner });
check('moved opp now in stage B', movedOpp.json?.data?.stageId === b, JSON.stringify(movedOpp.json));

const blockedPipeline = await req('DELETE', `/pipelines/${pid}`, { token: owner });
check('DELETE pipeline with opps blocked 409 (F2.5 Restrict)', blockedPipeline.status === 409, JSON.stringify(blockedPipeline.json));

const delOpp = await req('DELETE', `/opportunities/${oppId}`, { token: owner });
check('DELETE opportunity 200', delOpp.status === 200, JSON.stringify(delOpp.json));

const delPipeline = await req('DELETE', `/pipelines/${pid}`, { token: owner });
check('DELETE pipeline 200 once empty', delPipeline.status === 200, JSON.stringify(delPipeline.json));
const gonePipeline = await req('GET', `/pipelines/${pid}`, { token: owner });
check('deleted pipeline 404', gonePipeline.status === 404, JSON.stringify(gonePipeline.json));

check('sales POST /pipelines 403 (crm.configure)', (await req('POST', '/pipelines', { token: sales, body: { name: 'Nope' } })).status === 403);
check('sales GET /pipelines 200 (crm.view)', (await req('GET', '/pipelines', { token: sales })).status === 200);

// --- Custom fields (F2.2) ---
const fkey = `smoke_pick_${RUN}`;
const badField = await req('POST', '/custom-fields', { token: owner, body: { entity: 'CONTACT', key: fkey, label: 'Smoke Pick', type: 'SELECT', options: [] } });
check('SELECT field with no options 400', badField.status === 400, JSON.stringify(badField.json));

const field = await req('POST', '/custom-fields', { token: owner, body: { entity: 'CONTACT', key: fkey, label: 'Smoke Pick', type: 'SELECT', options: ['One', 'Two'] } });
check('POST custom field 201', field.status === 201 && field.json.data.key === fkey, JSON.stringify(field.json));
const fieldId = field.json?.data?.id;

const updatedField = await req('PATCH', `/custom-fields/${fieldId}`, { token: owner, body: { label: 'Smoke Pick Renamed', version: field.json?.data?.version } });
check('PATCH custom field 200 + label', updatedField.status === 200 && updatedField.json.data.label === 'Smoke Pick Renamed', JSON.stringify(updatedField.json));

const staleField = await req('PATCH', `/custom-fields/${fieldId}`, { token: owner, body: { label: 'Stale', version: 1 } });
check('stale custom field PATCH 409', staleField.status === 409, JSON.stringify(staleField.json));

const archived = await req('DELETE', `/custom-fields/${fieldId}`, { token: owner });
check('DELETE custom field archives 200', archived.status === 200, JSON.stringify(archived.json));
const listDefault = await req('GET', '/custom-fields?entity=CONTACT', { token: owner });
check('archived field hidden by default', !listDefault.json.data.some((f) => f.id === fieldId));
const listArchived = await req('GET', '/custom-fields?entity=CONTACT&includeArchived=true', { token: owner });
check('archived field visible with includeArchived', listArchived.json.data.some((f) => f.id === fieldId && f.isArchived === true));

// --- Activities ---
const companies = await req('GET', '/companies', { token: owner });
const companyId = companies.json?.data?.[0]?.id;
check('got a company for activity', !!companyId);

const note = await req('POST', '/activities', { token: owner, body: { entityType: 'COMPANY', entityId: companyId, type: 'NOTE', title: 'Smoke note', body: 'hello' } });
check('POST /activities 201', note.status === 201 && !!note.json.data.id, JSON.stringify(note.json));

const notes = await req('GET', `/activities?entityType=COMPANY&entityId=${companyId}`, { token: owner });
check('GET /activities includes note', notes.status === 200 && notes.json.data.some((x) => x.id === note.json.data.id), JSON.stringify(notes.json).slice(0, 300));

const ghostNote = await req('POST', '/activities', { token: owner, body: { entityType: 'COMPANY', entityId: 'does-not-exist', type: 'NOTE', title: 'ghost' } });
check('activity on unknown entity rejected (not 2xx)', ghostNote.status >= 400, JSON.stringify(ghostNote.json));

check('sales POST /custom-fields 403 (crm.configure)', (await req('POST', '/custom-fields', { token: sales, body: { entity: 'CONTACT', key: 'sales_try', label: 'Sales Try', type: 'TEXT' } })).status === 403);

// --- Audit trail ---
const audit = await req('GET', '/audit?limit=100', { token: owner });
const actions = (audit.json?.data ?? []).map((e) => e.action);
check('audit has field.created', actions.includes('field.created'), JSON.stringify(actions));
check('audit has field.archived', actions.includes('field.archived'));
check('audit has pipeline + stage events', actions.some((x) => x.startsWith('pipeline.')) && actions.some((x) => x.startsWith('stage.')));

// --- Cleanup: remove anything this suite (or a previous failed run) left behind ---
const leftoverPipelines = (await req('GET', '/pipelines', { token: owner })).json?.data ?? [];
const leftoverOpps = (await req('GET', '/opportunities?q=Smoke%20Opp&limit=100', { token: owner })).json?.data ?? [];
for (const o of leftoverOpps) {
  if (o.name?.startsWith('Smoke Opp')) await req('DELETE', `/opportunities/${o.id}`, { token: owner });
}
for (const p of leftoverPipelines) {
  if (p.name?.startsWith('Smoke Pipeline')) await req('DELETE', `/pipelines/${p.id}`, { token: owner });
}
const finalPipelines = (await req('GET', '/pipelines', { token: owner })).json?.data ?? [];
check('cleanup left only seed pipelines', finalPipelines.every((p) => !p.name.startsWith('Smoke Pipeline')), JSON.stringify(finalPipelines.map((p) => p.name)));

console.log(`\n=== SMOKE RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
