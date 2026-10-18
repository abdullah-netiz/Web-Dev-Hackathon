const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4000';
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

const owner = await login('owner@demo.test');
const sales = await login('sales@demo.test');

// --- catalogue ---
const catalogue = await req('GET', '/dashboard/widgets', { token: owner });
const keys = (catalogue.json?.data ?? []).map((w) => w.key);
check('GET /dashboard/widgets 200 with 8 widgets', catalogue.status === 200 && keys.length === 8, JSON.stringify(keys));

// --- owner (workspace scope, sees values) ---
const ownerDash = await req('GET', '/dashboard', { token: owner });
const widgets = ownerDash.json?.data?.widgets ?? [];
check('owner dashboard 200', ownerDash.status === 200, JSON.stringify(ownerDash.json).slice(0, 200));
check('owner scope is workspace', ownerDash.json?.data?.scope === 'workspace', ownerDash.json?.data?.scope);
check('owner dashboard has all 8 widgets', widgets.length === 8, JSON.stringify(widgets.map((w) => w.key)));
check('every widget has a drill-down route', widgets.every((w) => w.drilldown?.route), JSON.stringify(widgets.map((w) => [w.key, w.drilldown?.route])));
check('every widget carries a Section 7 label', widgets.every((w) => w.label && w.unit), '');

const pipeline = widgets.find((w) => w.key === 'pipeline_value_by_stage');
check('owner sees pipeline values (crm.view_values)', pipeline?.redacted === false && pipeline?.value !== null, JSON.stringify(pipeline?.value));
check('pipeline breakdown is per stage', Array.isArray(pipeline?.breakdown) && pipeline.breakdown.length >= 1, JSON.stringify(pipeline?.breakdown));
check('pipeline stage drill-downs present', (pipeline?.breakdown ?? []).every((b) => b.drilldown?.query?.stageId === b.stageId));

// --- metric consistency (F5.2): dashboard recovery count == recovery list length ---
const recovery = await req('GET', '/leads/recovery', { token: owner });
const recoveryWidget = widgets.find((w) => w.key === 'recovery_queue');
check('recovery figure matches the recovery list', recoveryWidget?.value === (recovery.json?.data ?? []).length, `${recoveryWidget?.value} vs ${(recovery.json?.data ?? []).length}`);

const availability = widgets.find((w) => w.key === 'team_availability');
const availTotal = (availability?.breakdown ?? []).reduce((s, b) => s + b.count, 0);
check('team availability sums to 3 active members', availTotal === 3, JSON.stringify(availability?.breakdown));

const payments = widgets.find((w) => w.key === 'payments_this_month');
check('payments widget present with net value', payments && typeof payments.value === 'number', JSON.stringify(payments));

// --- sales (USER) sees personal figures and no money ---
const salesDash = await req('GET', '/dashboard', { token: sales });
check('sales dashboard 200 (dashboard.view)', salesDash.status === 200, JSON.stringify(salesDash.json).slice(0, 160));
check('sales scope is personal', salesDash.json?.data?.scope === 'personal', salesDash.json?.data?.scope);
const salesWidgets = salesDash.json?.data?.widgets ?? [];
const salesLeds = salesWidgets.find((w) => w.key === 'leads_new_today');
check('sales new-leads widget is personal scope', salesLeds?.scope === 'personal', JSON.stringify(salesLeds?.scope));
const salesPipeline = salesWidgets.find((w) => w.key === 'pipeline_value_by_stage');
check('sales cannot see pipeline values (redacted)', salesPipeline?.redacted === true && salesPipeline?.value === null, JSON.stringify(salesPipeline));
check('sales payments redacted', salesDash.json?.data?.canSeeValues === false, JSON.stringify(salesDash.json?.data?.canSeeValues));

// --- F5.5 saved widget preferences ---
const prefsDefault = await req('GET', '/dashboard/prefs', { token: owner });
check('default prefs = all widgets', (prefsDefault.json?.data?.widgets ?? []).length === 8, JSON.stringify(prefsDefault.json));
const saved = await req('PATCH', '/dashboard/prefs', { token: owner, body: { widgets: ['leads_new_today', 'recovery_queue'] } });
check('PATCH /dashboard/prefs 200', saved.status === 200, JSON.stringify(saved.json));
const prefsAfter = await req('GET', '/dashboard/prefs', { token: owner });
check('preference remembered', JSON.stringify(prefsAfter.json?.data?.widgets) === JSON.stringify(['leads_new_today', 'recovery_queue']), JSON.stringify(prefsAfter.json?.data?.widgets));
const ignored = await req('PATCH', '/dashboard/prefs', { token: owner, body: { widgets: ['leads_new_today', 'not_a_widget'] } });
check('unknown widget keys are dropped', JSON.stringify(ignored.json?.data?.widgets) === JSON.stringify(['leads_new_today']), JSON.stringify(ignored.json));
const filtered = await req('GET', '/dashboard?widgets=leads_new_today', { token: owner });
check('dashboard?widgets= filters figures', (filtered.json?.data?.widgets ?? []).length === 1, JSON.stringify(filtered.json?.data?.widgets?.map((w) => w.key)));

// --- restore all widgets ---
await req('PATCH', '/dashboard/prefs', { token: owner, body: { widgets: keys } });
console.log(`\n=== DASHBOARD SMOKE RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
