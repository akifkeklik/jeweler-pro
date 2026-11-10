<template>
  <div>
    <div class="password-update-card">
      <span class="setting-title">{{ $t('settings.security.changePassword') }}</span>
      <p class="setting-hint mb-3">{{ $t('settings.security.policy') }}</p>
      <form @submit.prevent="changePassword">
        <div class="settings-grid-3">
          <div class="form-group">
            <label class="form-label" for="pwd-current">{{ $t('settings.security.current') }} *</label>
            <input id="pwd-current" v-model="password.current" required type="password" class="pwd-input settings-input-full" autocomplete="current-password" />
          </div>
          <div class="form-group">
            <label class="form-label" for="pwd-next">{{ $t('settings.security.next') }} *</label>
            <input id="pwd-next" v-model="password.next" required :minlength="minLength" type="password" :placeholder="$t('settings.security.minLength')" class="pwd-input settings-input-full" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label class="form-label" for="pwd-confirm">{{ $t('settings.security.confirm') }} *</label>
            <input id="pwd-confirm" v-model="password.confirm" required :minlength="minLength" type="password" class="pwd-input settings-input-full" autocomplete="new-password" />
          </div>
        </div>
        <p v-if="passwordError" class="form-error mt-2" role="alert">
          <v-icon size="14" class="mr-1">mdi-alert-circle</v-icon>{{ passwordError }}
        </p>
        <div class="mt-3">
          <v-btn
            size="small" type="submit" class="jp-primary" :loading="passwordLoading"
            :disabled="!password.current || password.next.length < minLength || password.next !== password.confirm"
          >
            <v-icon start size="14">mdi-lock-reset</v-icon>{{ $t('settings.security.changePassword') }}
          </v-btn>
        </div>
      </form>
    </div>

    <div class="session-security-card mt-4">
      <span class="setting-title">{{ $t('settings.security.sessionInfo') }}</span>
      <div class="session-meta-row mt-2">
        <div class="meta-item">
          <span class="meta-label">{{ $t('settings.security.sessionType') }}</span>
          <span class="meta-val">{{ sessionType }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">{{ $t('settings.security.sessionExpiry') }}</span>
          <span class="meta-val tabular">{{ sessionExpiry }}</span>
        </div>
      </div>

      <span class="setting-title mt-4 d-block">{{ $t('settings.security.devices') }}</span>
      <div class="table-wrap mt-2" data-testid="active-sessions">
        <table class="jp-enterprise-table">
          <thead>
            <tr>
              <th>{{ $t('settings.security.colDevice') }}</th>
              <th>IP</th>
              <th>{{ $t('settings.security.colType') }}</th>
              <th>{{ $t('settings.security.colLastUsed') }}</th>
              <th class="text-right col-narrow"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in sessions" :key="s.id">
              <td :title="s.userAgent">
                {{ describeUserAgent(s.userAgent) }}
                <span v-if="s.current" class="jp-badge jp-badge-success ml-1">{{ $t('settings.security.thisDevice') }}</span>
              </td>
              <td class="tabular cell-sub">{{ s.ip || '—' }}</td>
              <td class="cell-sub">{{ s.persistent ? $t('settings.security.rememberMe') : $t('settings.security.browser') }}</td>
              <td class="tabular cell-sub">{{ $dateTime(s.lastUsedAt) }}</td>
              <td class="text-right">
                <v-btn v-if="!s.current" size="x-small" variant="text" class="danger-action" @click="revokeSession(s)">{{ $t('settings.security.endSession') }}</v-btn>
              </td>
            </tr>
            <tr v-if="!sessions.length && !loadingSessions">
              <td colspan="5" class="empty-state-cell">{{ $t('settings.security.noSessions') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-3 d-flex flex-wrap ga-2">
        <v-btn size="small" class="jp-btn-danger" data-testid="logout-this-device" @click="logoutHere">
          <v-icon start size="14">mdi-logout-variant</v-icon>{{ $t('settings.security.logoutHere') }}
        </v-btn>
        <v-btn size="small" class="jp-secondary" data-testid="logout-all-devices" @click="logoutEverywhere">
          <v-icon start size="14">mdi-devices</v-icon>{{ $t('settings.security.logoutEverywhere') }}
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import apiService from '@/services/api';
import { authState, clearSession, logout, logoutAllDevices } from '@/services/authSession';
import { confirmAction } from '@/services/confirm';
import { dateTime, t } from '@/i18n';
import { describeUserAgent, MIN_PASSWORD_LENGTH, sessionTypeLabel } from '@/services/settingsView';

interface DeviceSession {
  id: string;
  userAgent?: string;
  ip?: string;
  persistent?: boolean;
  current?: boolean;
  lastUsedAt?: string;
}

const emptyPassword = () => ({ current: '', next: '', confirm: '' });

/** Password change (signs every session out), this session's details and the active devices. */
export default defineComponent({
  name: 'SecuritySettings',
  data: () => ({
    minLength: MIN_PASSWORD_LENGTH,
    password: emptyPassword(),
    passwordError: '',
    passwordLoading: false,
    sessions: [] as DeviceSession[],
    loadingSessions: false,
  }),
  computed: {
    sessionType(): string {
      return sessionTypeLabel(authState);
    },
    sessionExpiry(): string {
      return authState.sessionExpiresAt ? dateTime(authState.sessionExpiresAt) : '—';
    },
  },
  mounted() {
    this.fetchSessions();
  },
  methods: {
    describeUserAgent,
    fail(err: unknown) {
      this.$store.dispatch('notifications/showError', (err as Error)?.message || t('errors.operationFailed'));
    },
    async fetchSessions() {
      this.loadingSessions = true;
      try {
        const res = await apiService.get<{ data?: DeviceSession[] }>('/api/auth/sessions');
        this.sessions = res?.data || [];
      } catch {
        this.sessions = [];
      } finally {
        this.loadingSessions = false;
      }
    },
    async revokeSession(s: DeviceSession) {
      const ok = await confirmAction({ message: t('settings.security.confirmEndSession'), tone: 'warning' });
      if (!ok) return;
      try {
        await apiService.delete(`/api/auth/sessions/${s.id}`);
        this.$store.dispatch('notifications/showSuccess', t('settings.security.sessionEnded'));
        await this.fetchSessions();
      } catch (err) {
        this.fail(err);
      }
    },
    async changePassword() {
      this.passwordError = '';
      if (this.password.next !== this.password.confirm) {
        this.passwordError = t('settings.security.mismatch');
        return;
      }
      if (this.password.next.length < MIN_PASSWORD_LENGTH) {
        this.passwordError = t('settings.users.passwordTooShort');
        return;
      }
      this.passwordLoading = true;
      try {
        await apiService.post('/api/auth/password', {
          currentPassword: this.password.current,
          newPassword: this.password.next,
        });
        this.password = emptyPassword();
        // The server revoked every session (including this one): sign in again.
        clearSession();
        this.$store.dispatch('notifications/showSuccess', t('settings.security.changed'));
        this.$router.replace('/login');
      } catch (error) {
        this.passwordError = (error as Error)?.message || t('settings.security.changeFailed');
      } finally {
        this.passwordLoading = false;
      }
    },
    async logoutHere() {
      await logout();
      this.$router.replace('/login');
    },
    async logoutEverywhere() {
      const ok = await confirmAction({ message: t('settings.security.confirmEverywhere'), tone: 'warning', confirmLabel: t('settings.security.logoutEverywhere') });
      if (!ok) return;
      try {
        await logoutAllDevices();
      } catch (err) {
        this.fail(err);
        return;
      }
      this.$router.replace('/login');
    },
  },
});
</script>

<style scoped src="@/styles/settings-pane.css"></style>

<style scoped>
.session-meta-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}
.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
}
.meta-label {
  font-size: 11px;
  color: var(--jp-text-muted);
}
.meta-val {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--jp-text-emphasis);
  display: flex;
  align-items: center;
}
.col-narrow {
  width: 90px;
}
</style>
