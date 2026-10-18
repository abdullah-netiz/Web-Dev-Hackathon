const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4000';
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
const login = async (email, password = 'Password123!') =>
  req('POST', '/auth/login', { body: { email, password } });

// ---------- F1.1 signup creates workspace + owner ----------
const ownerEmail = `omar.${RUN}@acme.test`;
const signup = await req('POST', '/auth/signup', {
  body: { workspaceName: `Acme Services ${RUN}`, name: 'Omar Owner', email: ownerEmail, password: 'Password123!' },
});
check('POST /auth/signup 201', signup.status === 201, JSON.stringify(signup.json).slice(0, 200));
const ownerToken = signup.json?.data?.token;
const owner = signup.json?.data?.user;
check('signup makes the first user an OWNER', owner?.baseLevel === 'OWNER', JSON.stringify(owner?.baseLevel));
check('owner holds every permission', owner?.permissions?.length === 15, JSON.stringify(owner?.permissions?.length));
check('signup returns a session without a password hash', !!ownerToken && owner && !('passwordHash' in owner));

const dup = await req('POST', '/auth/signup', {
  body: { workspaceName: 'Acme Clone', name: 'Someone', email: ownerEmail, password: 'Password123!' },
});
check('duplicate signup email is rejected (409)', dup.status === 409, String(dup.status));

const me = await req('GET', '/auth/me', { token: ownerToken });
check('GET /auth/me works with the new session', me.status === 200 && me.json?.data?.email === ownerEmail);

// ---------- F1.3 / Q6 workspace settings with OCC ----------
const ws = await req('GET', '/workspace', { token: ownerToken });
check('GET /workspace 200', ws.status === 200, String(ws.status));
check('slug derived from workspace name', ws.json?.data?.slug === `acme-services-${RUN}`, JSON.stringify(ws.json?.data?.slug));
const settingsVersion = ws.json?.data?.settings?.version;
check('workspace has settings with a version', settingsVersion === 1, String(settingsVersion));

const patchWs = await req('PATCH', '/workspace', {
  token: ownerToken,
  body: { name: 'Acme Services Ltd', ackWindowSec: 300, maxOpenLeads: 8, version: settingsVersion },
});
check('PATCH /workspace 200', patchWs.status === 200, JSON.stringify(patchWs.json).slice(0, 160));
check('workspace name + settings applied', patchWs.json?.data?.name === 'Acme Services Ltd' && patchWs.json?.data?.settings?.ackWindowSec === 300, JSON.stringify(patchWs.json?.data?.settings));
check('settings version incremented', patchWs.json?.data?.settings?.version === 2, String(patchWs.json?.data?.settings?.version));
const stale = await req('PATCH', '/workspace', { token: ownerToken, body: { ackWindowSec: 60, version: settingsVersion } });
check('stale settings version rejected (409)', stale.status === 409, String(stale.status));

// ---------- F1.2 invite members + default roles ----------
const inviteAdmin = await req('POST', '/members', {
  token: ownerToken,
  body: { name: 'Ada Admin', email: `ada.${RUN}@acme.test`, password: 'Password123!', baseLevel: 'ADMIN' },
});
check('POST /members invite 201', inviteAdmin.status === 201, JSON.stringify(inviteAdmin.json).slice(0, 160));
check('invited admin gets the built-in Admin role', inviteAdmin.json?.data?.role?.name === 'Admin', JSON.stringify(inviteAdmin.json?.data?.role));

const inviteUser = await req('POST', '/members', {
  token: ownerToken,
  body: { name: 'Uma User', email: `uma.${RUN}@acme.test`, password: 'Password123!', baseLevel: 'USER' },
});
check('invited user gets the built-in User role', inviteUser.json?.data?.role?.name === 'User', JSON.stringify(inviteUser.json?.data?.role));
const userId = inviteUser.json?.data?.id;

const membersList = await req('GET', '/members', { token: ownerToken });
check('GET /members lists 3 members', membersList.status === 200 && (membersList.json?.data ?? []).length === 3, JSON.stringify((membersList.json?.data ?? []).length));

// ---------- F1.3 configurable permissions ----------
const adminLogin = await login(`ada.${RUN}@acme.test`);
const adminToken = adminLogin.json?.data?.token;
const adminPerms = adminLogin.json?.data?.user?.permissions ?? [];
check('Admin holds all permissions except roles.manage', !adminPerms.includes('roles.manage') && adminPerms.includes('users.manage'), JSON.stringify(adminPerms));
const adminRoles = await req('GET', '/roles', { token: adminToken });
check('Admin cannot manage roles (403)', adminRoles.status === 403, String(adminRoles.status));
const adminMembers = await req('GET', '/members', { token: adminToken });
check('Admin can manage members (200)', adminMembers.status === 200, String(adminMembers.status));
const adminTouchOwner = await req('PATCH', `/members/${owner.id}`, { token: adminToken, body: { name: 'Hacked', version: owner.version ?? 1 } });
check('Admin cannot modify the Owner (403, F1.2)', adminTouchOwner.status === 403, String(adminTouchOwner.status));

// custom role with a narrow permission set
const createRole = await req('POST', '/roles', { token: ownerToken, body: { name: 'Sales', permissions: ['crm.view', 'crm.create', 'leads.view'] } });
check('POST /roles 201', createRole.status === 201, JSON.stringify(createRole.json).slice(0, 160));
const salesRoleId = createRole.json?.data?.id;
check('custom role is not a system role', createRole.json?.data?.isSystem === false);
const unknownPerm = await req('POST', '/roles', { token: ownerToken, body: { name: 'Bad', permissions: ['crm.view', 'not.real'] } });
check('unknown permission key rejected (400)', unknownPerm.status === 400, String(unknownPerm.status));

const dupRole = await req('POST', '/roles', { token: ownerToken, body: { name: 'Sales', permissions: [] } });
check('duplicate role name rejected (409)', dupRole.status === 409, String(dupRole.status));

const patchRole = await req('PATCH', `/roles/${salesRoleId}`, { token: ownerToken, body: { permissions: ['crm.view', 'leads.view'], version: 1 } });
check('PATCH /roles/:id 200', patchRole.status === 200, JSON.stringify(patchRole.json).slice(0, 160));
const patchRoleStale = await req('PATCH', `/roles/${salesRoleId}`, { token: ownerToken, body: { permissions: ['crm.view'], version: 1 } });
check('stale role version rejected (409)', patchRoleStale.status === 409, String(patchRoleStale.status));

// ---------- custom role actually changes what the member can do (F1.3, F1.5) ----------
const inviteSales = await req('POST', '/members', {
  token: ownerToken,
  body: { name: 'Sana Sales', email: `sana.${RUN}@acme.test`, password: 'Password123!', baseLevel: 'USER', roleId: salesRoleId },
});
check('member invited into the custom role', inviteSales.json?.data?.role?.name === 'Sales', JSON.stringify(inviteSales.json?.data?.role));
const salesLogin = await login(`sana.${RUN}@acme.test`);
const salesToken = salesLogin.json?.data?.token;
const salesDash = await req('GET', '/dashboard', { token: salesToken });
check('custom role without dashboard.view is denied (403)', salesDash.status === 403, String(salesDash.status));
const salesMembers = await req('GET', '/members', { token: salesToken });
check('custom role without users.manage is denied (403)', salesMembers.status === 403, String(salesMembers.status));

// ---------- role deletion rules (Q4) ----------
const delSystem = await req('DELETE', `/roles/${(await req('GET', '/roles', { token: ownerToken })).json.data.find((r) => r.name === 'Admin').id}`, { token: ownerToken });
check('system role cannot be deleted (409)', delSystem.status === 409, String(delSystem.status));
const delAssigned = await req('DELETE', `/roles/${salesRoleId}`, { token: ownerToken });
check('role assigned to a member cannot be deleted (409)', delAssigned.status === 409, String(delAssigned.status));
const changeSalesRole = await req('PATCH', `/members/${inviteSales.json.data.id}`, { token: ownerToken, body: { roleId: null, version: inviteSales.json.data.version } });
check('member moved off the custom role', changeSalesRole.status === 200 && changeSalesRole.json?.data?.role === null, JSON.stringify(changeSalesRole.json?.data));
const delOk = await req('DELETE', `/roles/${salesRoleId}`, { token: ownerToken });
check('unassigned custom role deletes (200)', delOk.status === 200, JSON.stringify(delOk.json));

// ---------- F1.2 deactivation ----------
const deactivateOwner = await req('POST', `/members/${owner.id}/deactivate`, { token: ownerToken });
check('owner cannot be deactivated (409)', deactivateOwner.status === 409, String(deactivateOwner.status));
const deactivateUser = await req('POST', `/members/${userId}/deactivate`, { token: ownerToken });
check('POST /members/:id/deactivate 200', deactivateUser.status === 200 && deactivateUser.json?.data?.isActive === false, JSON.stringify(deactivateUser.json)?.slice(0, 160));
const deactivatedLogin = await login(`uma.${RUN}@acme.test`);
check('deactivated member cannot log in (401)', deactivatedLogin.status === 401, String(deactivatedLogin.status));
const reactivate = await req('POST', `/members/${userId}/reactivate`, { token: ownerToken });
check('POST /members/:id/reactivate 200', reactivate.status === 200 && reactivate.json?.data?.isActive === true, String(reactivate.status));

const selfDeactivate = await req('POST', `/members/${owner.id}/deactivate`, { token: ownerToken });
check('self-deactivation blocked (409)', selfDeactivate.status === 409, String(selfDeactivate.status));

// ---------- F1.6 workspace isolation ----------
const demoLogin = await login('owner@demo.test');
const demoToken = demoLogin.json?.data?.token;
const demoCompany = await req('POST', '/companies', { token: demoToken, body: { name: `Isolation Co ${RUN}` } });
const demoCompanyId = demoCompany.json?.data?.id;
check('demo owner created a company for the isolation test', !!demoCompanyId, JSON.stringify(demoCompany.json).slice(0, 160));
const crossRead = await req('GET', `/companies/${demoCompanyId}`, { token: ownerToken });
check('foreign id returns 404 (F1.6)', crossRead.status === 404, String(crossRead.status));
const acmeCompanies = await req('GET', '/companies', { token: ownerToken });
check('acme sees zero demo companies', (acmeCompanies.json?.data ?? []).length === 0, JSON.stringify((acmeCompanies.json?.data ?? []).length));

console.log(`\n=== WORKSPACES SMOKE RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
