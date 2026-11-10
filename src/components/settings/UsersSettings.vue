<template>
  <div>
    <div class="account-info-grid">
      <div class="info-tile">
        <span class="tile-label">{{ $t('settings.users.profile') }}</span>
        <strong class="tile-val">{{ me.name || me.email || '' }}</strong>
      </div>
      <div class="info-tile">
        <span class="tile-label">{{ $t('settings.users.email') }}</span>
        <strong class="tile-val">{{ me.email || '' }}</strong>
      </div>
      <div class="info-tile">
        <span class="tile-label">{{ $t('settings.users.role') }}</span>
        <strong class="tile-val">{{ roleLabel(me.role) }}</strong>
      </div>
      <div class="info-tile">
        <span class="tile-label">{{ $t('settings.users.session') }}</span>
        <strong class="tile-val"><span class="live-dot mr-1"></span>{{ sessionType }}</strong>
      </div>
    </div>

    <div class="permissions-card mt-4" data-testid="my-permissions">
      <span class="setting-title">{{ $t('settings.users.myPermissions') }}</span>
      <div class="badge-wrap mt-2">
        <span v-for="p in myPermissions" :key="p" class="jp-badge jp-badge-neutral" :title="p">{{ permissionLabel(p) }}</span>
        <span v-if="!myPermissions.length" class="setting-hint">{{ $t('settings.users.noPermissions') }}</span>
      </div>
    </div>

    <div v-if="metadata" class="permissions-card mt-4" data-testid="permission-matrix">
      <span class="setting-title">{{ $t('settings.users.matrix') }}</span>
      <div class="table-wrap mt-2">
        <table class="jp-enterprise-table">
          <thead>
            <tr>
              <th>{{ $t('settings.users.module') }}</th>
              <th v-for="role in metadata.roles" :key="role.id" class="text-center col-role">{{ roleLabel(role.id, role.label) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="perm in metadata.permissions" :key="perm.id">
              <td>
                {{ permissionLabel(perm.id, perm.label) }}
                <span class="perm-id">{{ perm.id }}</span>
              </td>
              <td v-for="role in metadata.roles" :key="role.id" class="text-center">
                <v-icon
                  v-if="role.permissions.includes(perm.id)"
                  size="16"
                  class="ok-icon"
                  :aria-label="$t('settings.users.granted')"
                >mdi-check-circle</v-icon>
                <v-icon v-else size="16" class="no-icon" :aria-label="$t('settings.users.denied')">mdi-minus-circle-outline</v-icon>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="$can('users:read')" class="user-management-card mt-4" data-testid="user-management">
      <div class="card-head">
        <div>
          <span class="setting-title">{{ $t('settings.users.staff') }}</span>
          <p class="setting-hint mb-0">{{ $t('settings.users.staffHint') }}</p>
        </div>
        <div class="card-head-actions">
          <v-btn size="x-small" variant="text" :loading="loadingUsers" @click="fetchUsers">
            <v-icon size="12" class="mr-1">mdi-refresh</v-icon>{{ $t('common.refresh') }}
          </v-btn>
          <v-btn v-if="$can('users:write')" size="small" class="jp-primary" data-testid="add-user" @click="dialogs.create = true">
            <v-icon size="14" class="mr-1">mdi-account-plus</v-icon>{{ $t('settings.users.addUser') }}
          </v-btn>
        </div>
      </div>
      <div class="table-wrap">
        <table class="jp-enterprise-table">
          <thead>
            <tr>
              <th>{{ $t('settings.users.colUser') }}</th>
              <th>{{ $t('settings.users.colRole') }}</th>
              <th>{{ $t('settings.users.colBranch') }}</th>
              <th>{{ $t('settings.users.colExtra') }}</th>
              <th>{{ $t('common.status') }}</th>
              <th class="text-right col-actions">{{ $t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td>
                <div class="user-cell">
                  <div class="user-avatar-sm">{{ userInitials(u.name || u.email) }}</div>
                  <div>
                    <strong class="d-block">{{ u.name || $t('settings.users.unnamed') }}</strong>
                    <span class="cell-sub">{{ u.email }}</span>
                  </div>
                </div>
              </td>
              <td>
                <span class="jp-badge" :class="u.role === 'admin' ? 'jp-badge-warning' : u.role === 'manager' ? 'jp-badge-info' : 'jp-badge-neutral'">
                  {{ roleLabel(u.role) }}
                </span>
              </td>
              <td class="cell-sub">{{ u.branch || '—' }}</td>
              <td>
                <div v-if="u.customPermissions && u.customPermissions.length" class="badge-wrap">
                  <span v-for="cp in u.customPermissions.slice(0, 2)" :key="cp" class="jp-badge jp-badge-neutral" :title="cp">{{ permissionLabel(cp) }}</span>
                  <span v-if="u.customPermissions.length > 2" class="jp-badge jp-badge-neutral">+{{ u.customPermissions.length - 2 }}</span>
                </div>
                <span v-else class="cell-sub">{{ $t('settings.users.defaultRolePerms') }}</span>
              </td>
              <td>
                <span class="jp-badge" :class="u.active ? 'jp-badge-success' : 'jp-badge-danger'">
                  {{ u.active ? $t('common.active') : $t('common.inactive') }}
                </span>
              </td>
              <td class="text-right">
                <div class="row-actions" :data-testid="`user-actions-${u.email}`">
                  <v-btn
                    v-if="$can('users:write') && (u.id === me.id || canManage(u))"
                    icon size="x-small" variant="text"
                    :title="$t('settings.users.editTitle')" :aria-label="$t('settings.users.editTitle')"
                    @click="openEdit(u)"
                  ><v-icon size="14">mdi-pencil-outline</v-icon></v-btn>
                  <v-btn
                    v-if="$can('users:write') && u.id !== me.id && canManage(u) && u.active"
                    icon size="x-small" variant="text"
                    :title="$t('settings.users.sendReset')" :aria-label="$t('settings.users.sendReset')"
                    @click="sendResetLink(u)"
                  ><v-icon size="14">mdi-email-lock-outline</v-icon></v-btn>
                  <v-btn
                    v-if="$can('users:write') && u.id !== me.id && canManage(u)"
                    icon size="x-small" variant="text"
                    :title="$t('settings.users.revokeAll')" :aria-label="$t('settings.users.revokeAll')"
                    @click="revokeUserSessions(u)"
                  ><v-icon size="14">mdi-logout-variant</v-icon></v-btn>
                  <v-btn
                    v-if="$can('users:write') && u.id !== me.id && canManage(u)"
                    icon size="x-small" variant="text"
                    :class="u.active ? 'warn-action' : 'ok-action'"
                    :title="u.active ? $t('settings.users.deactivate') : $t('settings.users.activate')"
                    :aria-label="u.active ? $t('settings.users.deactivate') : $t('settings.users.activate')"
                    @click="toggleUserStatus(u)"
                  ><v-icon size="14">{{ u.active ? 'mdi-account-off-outline' : 'mdi-account-check-outline' }}</v-icon></v-btn>
                  <v-btn
                    v-if="$can('users:delete') && u.id !== me.id && canManage(u) && !u.active"
                    icon size="x-small" variant="text" class="danger-action"
                    :title="$t('settings.users.deleteForever')" :aria-label="$t('settings.users.deleteForever')"
                    @click="deleteUser(u)"
                  ><v-icon size="14">mdi-delete-outline</v-icon></v-btn>
                </div>
              </td>
            </tr>
            <tr v-if="!users.length && !loadingUsers">
              <td colspan="6" class="empty-state-cell">{{ $t('settings.users.empty') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="$can('audit:read')" class="audit-log-card mt-4">
      <div class="card-head">
        <div>
          <span class="setting-title">{{ $t('settings.users.audit') }}</span>
          <p class="setting-hint mb-0">{{ $t('settings.users.auditHint') }}</p>
        </div>
        <v-btn size="x-small" variant="text" :loading="loadingAudit" @click="fetchAuditLogs">
          <v-icon size="12" class="mr-1">mdi-refresh</v-icon>{{ $t('common.refresh') }}
        </v-btn>
      </div>
      <div class="table-wrap audit-table-wrap">
        <table class="jp-enterprise-table">
          <thead>
            <tr>
              <th class="col-time">{{ $t('settings.users.auditTime') }}</th>
              <th>{{ $t('settings.users.auditAction') }}</th>
              <th>{{ $t('settings.users.auditResource') }}</th>
              <th>{{ $t('settings.users.auditResourceId') }}</th>
              <th>{{ $t('settings.users.auditCorrelation') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in auditLogs" :key="log._id">
              <td class="tabular cell-sub">{{ $dateTime(log.createdAt, true) }}</td>
              <td><span class="jp-badge jp-badge-info">{{ log.action }}</span></td>
              <td>{{ log.resourceType }}</td>
              <td class="tabular cell-sub">#{{ log.resourceId }}</td>
              <td class="tabular cell-sub">{{ log.correlationId ? log.correlationId.slice(0, 12) + '…' : '—' }}</td>
            </tr>
            <tr v-if="!auditLogs.length">
              <td colspan="5" class="empty-state-cell">{{ $t('settings.users.auditEmpty') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <UserCreateDialog v-model="dialogs.create" :metadata="metadata" @saved="fetchUsers" />
    <UserEditDialog v-model="dialogs.edit" :user="editTarget" :metadata="metadata" @saved="fetchUsers" />
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import apiService from '@/services/api';
import { authState, hasPermission } from '@/services/authSession';
import { confirmAction } from '@/services/confirm';
import { t } from '@/i18n';
import {
  canManageUser,
  permissionLabel,
  roleLabel,
  sessionTypeLabel,
  userInitials,
  type ManagedUser,
  type PermissionInfo,
  type UserMetadata,
} from '@/services/settingsView';
import UserCreateDialog from './UserCreateDialog.vue';
import UserEditDialog from './UserEditDialog.vue';

type CurrentUser = { id?: string; name?: string; email?: string; role?: string; branch?: string; permissions?: readonly string[] };
interface AuditLog { _id: string; createdAt: string; action: string; resourceType: string; resourceId: string; correlationId?: string }

/**
 * The signed-in user's account and permissions, the role/permission matrix,
 * staff management and the audit log. What is shown follows the user's
 * permissions; the API enforces the same rules.
 */
export default defineComponent({
  name: 'UsersSettings',
  components: { UserCreateDialog, UserEditDialog },
  data: () => ({
    metadata: null as UserMetadata | null,
    permissionCatalog: [] as PermissionInfo[],
    users: [] as ManagedUser[],
    loadingUsers: false,
    auditLogs: [] as AuditLog[],
    loadingAudit: false,
    editTarget: null as ManagedUser | null,
    dialogs: { create: false, edit: false },
  }),
  computed: {
    me(): CurrentUser {
      return authState.user || {};
    },
    myPermissions(): readonly string[] {
      return this.me.permissions || [];
    },
    sessionType(): string {
      return sessionTypeLabel(authState);
    },
  },
  mounted() {
    this.fetchPermissionCatalog();
    if (hasPermission('users:read')) {
      this.fetchMetadata();
      this.fetchUsers();
    }
    if (hasPermission('audit:read')) this.fetchAuditLogs();
  },
  methods: {
    roleLabel,
    userInitials,
    permissionLabel(id: string, fallback?: string) {
      return permissionLabel(id, fallback, this.metadata?.permissions || this.permissionCatalog);
    },
    canManage(u: ManagedUser) {
      return canManageUser(this.me, u);
    },
    notifyError(err: unknown) {
      this.$store.dispatch('notifications/showError', (err as Error)?.message || t('errors.operationFailed'));
    },
    async fetchPermissionCatalog() {
      try {
        const res = await apiService.get<{ permissions?: PermissionInfo[] }>('/api/auth/permission-catalog');
        this.permissionCatalog = res?.permissions || [];
      } catch {
        this.permissionCatalog = [];
      }
    },
    async fetchMetadata() {
      try {
        this.metadata = await apiService.get<UserMetadata>('/api/users/metadata');
      } catch (err) {
        this.metadata = null;
        console.warn('Permission metadata unavailable:', err);
      }
    },
    async fetchUsers() {
      this.loadingUsers = true;
      try {
        const res = await apiService.get<{ data?: ManagedUser[] }>('/api/users');
        this.users = res?.data || [];
      } catch (err) {
        console.warn('Users fetch error:', err);
      } finally {
        this.loadingUsers = false;
      }
    },
    async fetchAuditLogs() {
      this.loadingAudit = true;
      try {
        const data = await apiService.get<AuditLog[]>('/api/audit?limit=25');
        this.auditLogs = data || [];
      } catch {
        this.auditLogs = [];
      } finally {
        this.loadingAudit = false;
      }
    },
    openEdit(u: ManagedUser) {
      this.editTarget = u;
      this.dialogs.edit = true;
    },
    async toggleUserStatus(u: ManagedUser) {
      const nextStatus = !u.active;
      const name = u.name || u.email;
      const ok = await confirmAction({
        message: t(nextStatus ? 'settings.users.confirmActivate' : 'settings.users.confirmDeactivate', { name }),
        tone: nextStatus ? 'default' : 'warning',
        confirmLabel: t(nextStatus ? 'settings.users.activate' : 'settings.users.deactivate'),
      });
      if (!ok) return;
      try {
        await apiService.patch(`/api/users/${u.id}/status`, { active: nextStatus });
        await this.fetchUsers();
        this.$store.dispatch('notifications/showSuccess', t(nextStatus ? 'settings.users.activated' : 'settings.users.deactivated'));
      } catch (err) {
        this.notifyError(err);
      }
    },
    async deleteUser(u: ManagedUser) {
      const ok = await confirmAction({
        message: t('settings.users.confirmDelete', { name: u.name || u.email }),
        tone: 'danger',
        confirmLabel: t('settings.users.deleteForever'),
      });
      if (!ok) return;
      try {
        await apiService.delete(`/api/users/${u.id}`);
        this.users = this.users.filter((item) => item.id !== u.id);
        this.$store.dispatch('notifications/showSuccess', t('settings.users.deleted'));
      } catch (err) {
        this.notifyError(err);
      }
    },
    async revokeUserSessions(u: ManagedUser) {
      const ok = await confirmAction({ message: t('settings.users.confirmRevoke', { name: u.name || u.email }), tone: 'warning' });
      if (!ok) return;
      try {
        await apiService.post(`/api/users/${u.id}/sessions/revoke`);
        this.$store.dispatch('notifications/showSuccess', t('settings.users.sessionsRevoked'));
      } catch (err) {
        this.notifyError(err);
      }
    },
    async sendResetLink(u: ManagedUser) {
      const ok = await confirmAction({ message: t('settings.users.confirmReset', { email: u.email }) });
      if (!ok) return;
      try {
        await apiService.post(`/api/users/${u.id}/password-reset`);
        this.$store.dispatch('notifications/showSuccess', t('settings.users.resetSent'));
      } catch (err) {
        this.notifyError(err);
      }
    },
  },
});
</script>

<style scoped src="@/styles/settings-pane.css"></style>

<style scoped>
.account-info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 8px;
}
.info-tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
  min-width: 0;
}
.tile-label {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--jp-text-muted);
}
.tile-val {
  font-size: 12.5px;
  color: var(--jp-text-emphasis);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
}
.audit-table-wrap {
  max-height: 320px;
  overflow-y: auto;
}
.col-role {
  width: 120px;
}
.col-actions {
  width: 150px;
}
.col-time {
  width: 150px;
}
.perm-id {
  margin-inline-start: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  color: var(--jp-text-subtle);
}
.ok-icon {
  color: var(--jp-success) !important;
}
.no-icon {
  color: var(--jp-text-subtle) !important;
}
.user-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.user-avatar-sm {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: var(--jp-surface-elevated);
  color: var(--jp-text-emphasis);
  font-size: 10.5px;
  font-weight: 700;
  flex-shrink: 0;
}
.row-actions {
  display: inline-flex;
  gap: 2px;
}
.warn-action {
  color: var(--jp-warning) !important;
}
.ok-action {
  color: var(--jp-success) !important;
}
</style>
