/**
 * The single list of permissions (F1.3). The frontend reads it from GET /meta/permissions, the
 * PermissionGuard checks it, and roles store a subset. A "manager" is a role with the team permissions.
 */
export const PERMISSIONS = {
  'crm.view': 'View contacts, companies and opportunities',
  'crm.create': 'Create CRM records',
  'crm.edit': 'Edit CRM records',
  'crm.delete': 'Delete CRM records',
  'crm.export': 'Export CRM records to CSV',
  'crm.view_values': 'See opportunity values (amounts)',
  'leads.view_all': 'See every lead in the workspace (not only own)',
  'leads.reassign': 'Reassign leads manually',
  'leads.manage_rules': 'Change assignment and escalation rules',
  'users.manage': 'Invite, edit and deactivate users; set availability of others',
  'roles.manage': 'Create and edit roles and permissions',
  'settings.manage': 'Edit workspace settings, pipelines and custom fields',
  'integrations.manage': 'Connect, change or remove integrations',
  'integrations.view': 'See integration status and sync history',
  'audit.view': 'Open the audit history',
  'dashboard.company': 'See company-wide dashboard figures',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Roles created with every new workspace. Owner/Admin get everything through their base level. */
export const DEFAULT_ROLES: { name: string; description: string; permissions: Permission[] }[] = [
  {
    name: 'Manager',
    description: 'Supervises a team: sees all leads and availability, can reassign, sees company figures',
    permissions: ['crm.view', 'crm.create', 'crm.edit', 'crm.export', 'crm.view_values', 'leads.view_all', 'leads.reassign', 'integrations.view', 'audit.view', 'dashboard.company'],
  },
  {
    name: 'Sales',
    description: 'Handles own leads and opportunities, sees values',
    permissions: ['crm.view', 'crm.create', 'crm.edit', 'crm.view_values'],
  },
  {
    name: 'Support',
    description: 'Handles conversations and own leads, does not see opportunity values',
    permissions: ['crm.view', 'crm.edit'],
  },
];

/** Permissions that make a role count as "manager" for the escalation chain (F3.5). */
export const MANAGER_PERMISSIONS: Permission[] = ['leads.view_all', 'leads.reassign'];

export function isManagerRole(permissions: readonly string[]): boolean {
  return MANAGER_PERMISSIONS.every((permission) => permissions.includes(permission));
}
