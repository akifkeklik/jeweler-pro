/**
 * Pure helpers behind the settings tabs: role/permission labels, the
 * additive custom-permission rules, device and uptime descriptions.
 * Roles and the permission catalog come from GET /api/users/metadata, so
 * the UI never drifts from what the backend enforces.
 */
import type { Store } from 'vuex';
import { n, t, tOptional } from '@/i18n';
import type { SettingsState } from '@/services/settings';

export function settingsOf(store: Store<unknown>): SettingsState {
  return (store.state as { settings: SettingsState }).settings;
}

/** Applies one preference instantly and confirms it with a small toast; no-op when unchanged. */
export function savePreference<K extends keyof SettingsState>(
  store: Store<unknown>,
  key: K,
  value: SettingsState[K],
): boolean {
  if (settingsOf(store)[key] === value) return false;
  store.dispatch('settings/setPreference', { key, value });
  store.dispatch('notifications/showSuccess', t('settings.toasts.saved'));
  return true;
}

/** The value of the select or input that fired a change event. */
export function eventValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

export interface PermissionInfo { id: string; label?: string }
export interface RoleInfo { id: string; label?: string; permissions: string[] }
export interface UserMetadata {
  roles: RoleInfo[];
  permissions: PermissionInfo[];
  assignableRoles: string[];
  assignablePermissions: string[];
}

export interface ManagedUser {
  id: string;
  name?: string;
  email: string;
  role: string;
  branch?: string;
  active?: boolean;
  customPermissions?: string[];
}

export function roleLabel(roleId: string | null | undefined, fallback?: string): string {
  return roleId ? tOptional(`roles.${roleId}`, fallback || roleId) : '—';
}

export function permissionLabel(permissionId: string, fallback: string | undefined, catalog: PermissionInfo[]): string {
  const serverLabel = fallback || catalog.find((p) => p.id === permissionId)?.label || permissionId;
  return tOptional(`permissions.${permissionId}`, serverLabel);
}

export function rolePermissions(metadata: UserMetadata | null, roleId: string): string[] {
  return metadata?.roles?.find((r) => r.id === roleId)?.permissions || [];
}

/** Custom permissions are additive, so only offer what the role lacks. */
export function extraPermissionsFor(metadata: UserMetadata | null, roleId: string): PermissionInfo[] {
  const fromRole = rolePermissions(metadata, roleId);
  return (metadata?.permissions || []).filter((p) => !fromRole.includes(p.id));
}

/** Drops permissions the role already grants before they are stored. */
export function withoutRolePermissions(metadata: UserMetadata | null, roleId: string, list: string[] | undefined): string[] {
  const fromRole = rolePermissions(metadata, roleId);
  return (list || []).filter((p) => !fromRole.includes(p));
}

export function isAssignable(metadata: UserMetadata | null, permissionId: string): boolean {
  return Boolean(metadata?.assignablePermissions?.includes(permissionId));
}

/** Admins manage everyone; managers manage staff of their own branch. */
export function canManageUser(
  actor: { role?: string; branch?: string },
  target: { role?: string; branch?: string },
): boolean {
  if (actor.role === 'admin') return true;
  return target.role === 'staff' && target.branch === actor.branch;
}

export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return t('settings.security.unknownDevice');
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Safari\//.test(ua) ? 'Safari'
          : t('settings.security.genericBrowser');
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad/.test(ua) ? 'iOS'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}

export function userInitials(value: string | null | undefined): string {
  if (!value) return 'JP';
  const parts = value.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toLocaleUpperCase();
  return value.slice(0, 2).toLocaleUpperCase();
}

export function formatUptime(uptimeSeconds: number | null | undefined): string {
  if (!Number.isFinite(uptimeSeconds)) return '—';
  const seconds = Math.floor(uptimeSeconds as number);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${n(h)}h ${n(m)}m`;
}

export function sessionTypeLabel(session: { accessToken: string | null; persistent: boolean }): string {
  if (!session.accessToken) return '—';
  return t(session.persistent ? 'settings.security.persistent' : 'settings.security.browserSession');
}

export const MIN_PASSWORD_LENGTH = 12;
