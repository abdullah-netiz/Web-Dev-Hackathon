import { describe, expect, it } from 'vitest';
import {
  ADMIN_DEFAULT_PERMISSIONS,
  ALL_PERMISSION_KEYS,
  resolveEffectivePermissions,
} from './permissions';

describe('resolveEffectivePermissions (F1.3)', () => {
  it('grants an Owner every permission regardless of role', () => {
    expect(resolveEffectivePermissions('OWNER', [])).toEqual(ALL_PERMISSION_KEYS);
  });

  it('grants exactly the role permissions for a non-owner', () => {
    expect(resolveEffectivePermissions('USER', ['crm.view', 'leads.view'])).toEqual([
      'crm.view',
      'leads.view',
    ]);
  });

  it('keeps Admin short of roles.manage', () => {
    expect(resolveEffectivePermissions('ADMIN', ADMIN_DEFAULT_PERMISSIONS)).not.toContain(
      'roles.manage',
    );
  });

  it('drops unknown permission keys', () => {
    expect(resolveEffectivePermissions('USER', ['crm.view', 'not.a.permission'])).toEqual([
      'crm.view',
    ]);
  });

  it('de-duplicates repeated keys', () => {
    expect(resolveEffectivePermissions('USER', ['crm.view', 'crm.view'])).toEqual(['crm.view']);
  });
});
