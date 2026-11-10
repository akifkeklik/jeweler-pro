import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAllLocales, setI18nPreferences, t } from '@/i18n';
import {
  canManageUser,
  describeUserAgent,
  eventValue,
  extraPermissionsFor,
  formatUptime,
  isAssignable,
  permissionLabel,
  roleLabel,
  savePreference,
  sessionTypeLabel,
  userInitials,
  withoutRolePermissions,
  type UserMetadata,
} from '@/services/settingsView';

beforeAll(() => loadAllLocales());
beforeEach(() => setI18nPreferences({ language: 'en' }));

const metadata: UserMetadata = {
  roles: [
    { id: 'admin', permissions: ['sales:read', 'users:write', 'audit:read'] },
    { id: 'staff', permissions: ['sales:read'] },
  ],
  permissions: [
    { id: 'sales:read', label: 'Sales' },
    { id: 'users:write', label: 'Users' },
    { id: 'audit:read', label: 'Audit' },
  ],
  assignableRoles: ['staff'],
  assignablePermissions: ['audit:read'],
};

describe('custom permissions are additive to the role', () => {
  it('only offers what the role does not already grant', () => {
    expect(extraPermissionsFor(metadata, 'staff').map((p) => p.id)).toEqual(['users:write', 'audit:read']);
    expect(extraPermissionsFor(metadata, 'admin')).toEqual([]);
    expect(extraPermissionsFor(null, 'staff')).toEqual([]);
  });

  it('strips role permissions before they are stored', () => {
    expect(withoutRolePermissions(metadata, 'staff', ['sales:read', 'audit:read'])).toEqual(['audit:read']);
    expect(withoutRolePermissions(metadata, 'staff', undefined)).toEqual([]);
  });

  it('only lets the actor delegate permissions the server marks assignable', () => {
    expect(isAssignable(metadata, 'audit:read')).toBe(true);
    expect(isAssignable(metadata, 'users:write')).toBe(false);
    expect(isAssignable(null, 'audit:read')).toBe(false);
  });
});

describe('who may manage whom', () => {
  it('admins manage everyone; managers only staff of their own branch', () => {
    expect(canManageUser({ role: 'admin' }, { role: 'manager', branch: 'B' })).toBe(true);
    expect(canManageUser({ role: 'manager', branch: 'A' }, { role: 'staff', branch: 'A' })).toBe(true);
    expect(canManageUser({ role: 'manager', branch: 'A' }, { role: 'staff', branch: 'B' })).toBe(false);
    expect(canManageUser({ role: 'manager', branch: 'A' }, { role: 'manager', branch: 'A' })).toBe(false);
  });
});

describe('labels', () => {
  it('prefers translations, then the server label, then the id', () => {
    expect(roleLabel('admin')).toBe(t('roles.admin'));
    expect(roleLabel('')).toBe('—');
    expect(roleLabel('auditor', 'Auditor')).toBe('Auditor');
    expect(permissionLabel('x:unknown', undefined, [{ id: 'x:unknown', label: 'From catalog' }])).toBe('From catalog');
    expect(permissionLabel('x:unknown', undefined, [])).toBe('x:unknown');
  });

  it('describes devices from the user agent', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36')).toBe('Chrome · Windows');
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')).toBe('Safari · iOS');
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Edg/120.0')).toBe('Edge · Windows');
    expect(describeUserAgent('')).toBe(t('settings.security.unknownDevice'));
  });

  it('builds initials and uptime', () => {
    expect(userInitials('Ayşe Yılmaz')).toBe('AY');
    expect(userInitials('ali.kaya@example.com')).toBe('AK');
    expect(userInitials('')).toBe('JP');
    expect(formatUptime(3 * 3600 + 25 * 60 + 9)).toBe('3h 25m');
    expect(formatUptime(null)).toBe('—');
    expect(formatUptime(Number.NaN)).toBe('—');
  });

  it('names the session type', () => {
    expect(sessionTypeLabel({ accessToken: null, persistent: true })).toBe('—');
    expect(sessionTypeLabel({ accessToken: 'x', persistent: true })).toBe(t('settings.security.persistent'));
    expect(sessionTypeLabel({ accessToken: 'x', persistent: false })).toBe(t('settings.security.browserSession'));
  });
});

describe('preferences', () => {
  it('applies a changed preference with a toast and skips an unchanged one', () => {
    const dispatch = vi.fn();
    const store = { state: { settings: { density: 'comfortable' } }, dispatch } as any;
    expect(savePreference(store, 'density', 'comfortable')).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(savePreference(store, 'density', 'compact')).toBe(true);
    expect(dispatch.mock.calls).toEqual([
      ['settings/setPreference', { key: 'density', value: 'compact' }],
      ['notifications/showSuccess', t('settings.toasts.saved')],
    ]);
  });

  it('reads the value of the element that fired the event', () => {
    const select = document.createElement('select');
    select.innerHTML = '<option value="iso">ISO</option>';
    select.value = 'iso';
    const event = new Event('change');
    Object.defineProperty(event, 'target', { value: select });
    expect(eventValue(event)).toBe('iso');
  });
});
