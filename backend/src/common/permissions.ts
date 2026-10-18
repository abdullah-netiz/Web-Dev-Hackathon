/**
 * The permission catalogue (F1.2). Roles store a subset of these keys; the
 * server-side `PermissionGuard` resolves them per request. Keys are also served
 * to the frontend via `GET /meta/permissions` so the UI and the API agree.
 */
export const PERMISSIONS = [
  { key: 'crm.view', label: 'View CRM records', group: 'CRM' },
  { key: 'crm.view_values', label: 'See opportunity values', group: 'CRM' },
  { key: 'crm.create', label: 'Create CRM records', group: 'CRM' },
  { key: 'crm.edit', label: 'Edit CRM records', group: 'CRM' },
  { key: 'crm.delete', label: 'Delete CRM records', group: 'CRM' },
  { key: 'crm.configure', label: 'Configure fields and pipelines', group: 'CRM' },
  { key: 'leads.view', label: 'View leads', group: 'Leads' },
  { key: 'leads.reassign', label: 'Reassign leads', group: 'Leads' },
  { key: 'integrations.manage', label: 'Manage integrations', group: 'Integrations' },
  { key: 'integrations.view_logs', label: 'View integration logs', group: 'Integrations' },
  { key: 'workspace.manage', label: 'Manage workspace settings', group: 'Workspace' },
  { key: 'users.manage', label: 'Manage users', group: 'Workspace' },
  { key: 'roles.manage', label: 'Manage roles and permissions', group: 'Workspace' },
  { key: 'dashboard.view', label: 'View dashboard', group: 'Workspace' },
  { key: 'audit.view', label: 'View audit history', group: 'Workspace' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const ALL_PERMISSION_KEYS: string[] = PERMISSIONS.map((permission) => permission.key);

/** Admin may do everything except reshape roles (F1.3). */
export const ADMIN_DEFAULT_PERMISSIONS: string[] = ALL_PERMISSION_KEYS.filter(
  (key) => key !== 'roles.manage',
);

export const USER_DEFAULT_PERMISSIONS: string[] = [
  'dashboard.view',
  'crm.view',
  'crm.create',
  'crm.edit',
  'leads.view',
];

export function isPermissionKey(value: string): value is PermissionKey {
  return ALL_PERMISSION_KEYS.includes(value);
}
