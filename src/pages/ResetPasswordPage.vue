<template>
  <div class="login-shell">
    <AuthPreferences />
    <div class="login-ambient-glow glow-gold"></div>
    <div class="login-ambient-glow glow-blue"></div>

    <div class="login-center-box">
      <!-- Luxury Brand Lockup -->
      <div class="login-brand">
        <div class="login-mark">
          <v-icon size="26">mdi-diamond-stone</v-icon>
        </div>
        <div class="login-brand-text">
          <div class="login-brand-name">JEWELER <span>PRO</span></div>
          <div class="login-brand-caption">{{ $t('auth.caption') }}</div>
        </div>
      </div>

      <div class="login-card jp-card">
        <div class="login-header">
          <span class="login-kicker">{{ $t('auth.reset.kicker') }}</span>
          <h1 class="login-title">{{ $t('auth.reset.title') }}</h1>
          <p class="login-subtitle">{{ $t('auth.reset.subtitle') }}</p>
        </div>

        <div v-if="status === 'checking'" class="text-center py-6" data-testid="reset-checking">
          <v-progress-circular indeterminate size="28" width="3" color="primary" />
          <p class="text-caption text-disabled mt-3 mb-0">{{ $t('auth.reset.checking') }}</p>
        </div>

        <div v-else-if="status === 'invalid'" class="text-center py-4" data-testid="reset-invalid">
          <v-icon size="44" class="mb-2 state-icon-bad">mdi-link-variant-off</v-icon>
          <h2 class="text-h6 font-weight-bold">{{ $t('auth.reset.invalidTitle') }}</h2>
          <p class="text-caption text-disabled mt-1 mb-4">
            {{ error || $t('auth.reset.invalidHint') }}
          </p>
          <v-btn color="primary" block @click="$router.push({ path: '/login', query: { forgot: '1' } })">
            {{ $t('auth.reset.requestNew') }}
          </v-btn>
        </div>

        <form v-else-if="status === 'ready'" class="login-form mt-4" data-testid="reset-form" @submit.prevent="submitReset">
          <div class="form-group">
            <label class="form-label" for="reset-new">{{ $t('auth.reset.newPassword') }}</label>
            <div class="input-with-icon">
              <v-icon size="16" class="field-icon">mdi-lock-outline</v-icon>
              <input
                id="reset-new"
                v-model="newPassword"
                type="password"
                placeholder="••••••••••••"
                class="login-input"
                minlength="12"
                autocomplete="new-password"
                required
              />
            </div>
            <div class="pw-strength-bar mt-1" role="img" :aria-label="$t('auth.reset.strength')">
              <div
                class="pw-strength-fill"
                :class="strengthClass"
                :style="{ width: strengthWidth }"
              ></div>
            </div>
          </div>

          <div class="form-group mt-3">
            <label class="form-label" for="reset-confirm">{{ $t('auth.reset.confirm') }}</label>
            <div class="input-with-icon">
              <v-icon size="16" class="field-icon">mdi-lock-check-outline</v-icon>
              <input
                id="reset-confirm"
                v-model="confirmPassword"
                type="password"
                placeholder="••••••••••••"
                class="login-input"
                minlength="12"
                autocomplete="new-password"
                required
              />
            </div>
          </div>

          <v-alert
            v-if="error"
            density="compact"
            type="error"
            variant="tonal"
            class="mt-3 py-1 text-caption"
            closable
            @click:close="error = ''"
          >
            {{ error }}
          </v-alert>

          <button
            type="submit"
            class="login-btn-submit mt-4 jp-primary"
            :disabled="loading || newPassword.length < minLength || newPassword !== confirmPassword"
          >
            <v-progress-circular
              v-if="loading"
              indeterminate
              size="16"
              width="2"
              class="mr-2"
            />
            <v-icon v-else start size="16">mdi-shield-check</v-icon>
            {{ $t('auth.reset.submit') }}
          </button>
          <p v-if="confirmPassword && newPassword !== confirmPassword" class="text-caption text-error mt-2 mb-0">
            {{ $t('auth.reset.mismatchShort') }}
          </p>

          <router-link to="/login" class="back-to-login-link mt-3">
            <v-icon size="14" class="mr-1 flip-rtl">mdi-arrow-left</v-icon> {{ $t('auth.backToLogin') }}
          </router-link>
        </form>

        <div v-else class="text-center py-4" data-testid="reset-completed">
          <v-icon size="48" class="mb-2 state-icon-ok">mdi-check-circle-outline</v-icon>
          <h2 class="text-h6 font-weight-bold text-white">{{ $t('auth.reset.doneTitle') }}</h2>
          <p class="text-caption text-disabled mt-1 mb-4">
            {{ $t('auth.reset.doneHint') }}
          </p>
          <v-btn
            color="primary"
            block
            @click="$router.push('/login')"
          >
            {{ $t('auth.reset.goToLogin') }}
          </v-btn>
        </div>

        <div class="login-security-badge mt-4">
          <v-icon size="13" class="badge-icon-ok">mdi-shield-lock</v-icon>
          <span>{{ $t('auth.reset.note') }}</span>
        </div>
      </div>

      <div class="login-footer">
        © {{ year }} JEWELER PRO • {{ $t('auth.rights') }}
      </div>
    </div>
  </div>
</template>

<script>
import apiService from '@/services/api';
import { t } from '@/i18n';
import AuthPreferences from '@/components/AuthPreferences.vue';

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export default {
  name: 'ResetPasswordPage',
  components: { AuthPreferences },
  data: () => ({
    // The token is kept only in component memory; it is removed from the URL
    // right away so it does not linger in history, screenshots or referrers.
    token: '',
    status: 'checking', // checking | invalid | ready | completed
    newPassword: '',
    confirmPassword: '',
    minLength: 12,
    loading: false,
    error: '',
    year: new Date().getFullYear(),
  }),
  computed: {
    completed() {
      return this.status === 'completed';
    },
    strengthClass() {
      if (this.newPassword.length >= 16) return 'strength-strong';
      if (this.newPassword.length >= 12) return 'strength-medium';
      return 'strength-weak';
    },
    strengthWidth() {
      if (!this.newPassword) return '0%';
      if (this.newPassword.length >= 16) return '100%';
      if (this.newPassword.length >= 12) return '75%';
      return '35%';
    },
  },
  async mounted() {
    const queryToken = this.$route.query.token;
    this.token = typeof queryToken === 'string' ? queryToken.trim() : '';
    if (this.$route.query.token !== undefined) {
      await this.$router.replace({ path: this.$route.path, query: {} });
    }
    await this.validateToken();
  },
  methods: {
    async validateToken() {
      if (!TOKEN_PATTERN.test(this.token)) {
        this.status = 'invalid';
        this.error = t('auth.reset.malformed');
        return;
      }
      this.status = 'checking';
      try {
        await apiService.post('/api/auth/reset-password/validate', { token: this.token });
        this.status = 'ready';
        this.error = '';
      } catch (err) {
        this.status = 'invalid';
        this.error = err.code === 'RESET_TOKEN_INVALID'
          ? t('auth.reset.used')
          : (err.message || t('auth.reset.validateFailed'));
      }
    },
    async submitReset() {
      if (this.newPassword !== this.confirmPassword) {
        this.error = t('auth.reset.mismatch');
        return;
      }
      if (this.newPassword.length < this.minLength) {
        this.error = t('auth.reset.tooShort', { min: this.minLength });
        return;
      }

      this.loading = true;
      this.error = '';
      try {
        await apiService.post('/api/auth/reset-password', {
          token: this.token,
          newPassword: this.newPassword,
        });
        this.token = '';
        this.newPassword = '';
        this.confirmPassword = '';
        this.status = 'completed';
        setTimeout(() => {
          this.$router.push({ path: '/login', query: { reset: 'success' } });
        }, 1500);
      } catch (err) {
        if (err.code === 'RESET_TOKEN_INVALID') {
          this.status = 'invalid';
          this.error = t('auth.reset.used');
        } else {
          this.error = err.message || t('auth.reset.failed');
        }
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>

<style scoped>
.login-shell {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--jp-bg);
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-ambient-glow {
  position: absolute;
  width: 500px;
  height: 500px;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.18;
  pointer-events: none;
}
.glow-gold {
  top: -100px;
  left: 20%;
  background: var(--jp-gold);
}
.glow-blue {
  bottom: -100px;
  right: 20%;
  background: var(--jp-info);
}

.login-center-box {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 420px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.login-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}
.login-mark {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--jp-gold) 0%, var(--jp-primary) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 18px var(--jp-gold-border);
}
.login-brand-name {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: var(--jp-text-emphasis);
}
.login-brand-name span {
  color: var(--jp-gold);
}
.login-brand-caption {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--jp-text-muted);
}

.login-card {
  width: 100%;
  padding: 28px 24px;
  background: var(--jp-surface-card);
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-lg);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
}

.login-header {
  text-align: center;
}
.login-kicker {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 1.5px;
}
.login-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--jp-text-emphasis);
  margin: 4px 0 2px;
}
.login-subtitle {
  font-size: 11px;
  color: var(--jp-text-muted);
  margin: 0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--jp-text-muted);
}

.input-with-icon {
  position: relative;
  display: flex;
  align-items: center;
}

.field-icon {
  position: absolute;
  left: 10px;
  color: var(--jp-text-subtle);
  pointer-events: none;
}

.login-input {
  width: 100%;
  height: 38px;
  padding: 0 12px 0 34px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  color: var(--jp-text-emphasis);
  font-size: 12px;
  outline: none;
  transition: border-color var(--jp-motion-fast) var(--jp-ease-standard);
}
.login-input:focus {
  border-color: var(--jp-gold);
}

.pw-strength-bar {
  width: 100%;
  height: 3px;
  background: var(--jp-border);
  border-radius: 2px;
  overflow: hidden;
}
.pw-strength-fill {
  height: 100%;
  transition: width var(--jp-motion-base) var(--jp-ease-standard), background-color var(--jp-motion-base) var(--jp-ease-standard);
}
.strength-weak {
  background-color: var(--jp-danger);
}
.strength-medium {
  background-color: var(--jp-warning);
}
.strength-strong {
  background-color: var(--jp-success);
}

.login-btn-submit {
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--jp-radius-sm);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, var(--jp-gold) 0%, var(--jp-primary) 100%);
  color: var(--jp-on-primary);
  box-shadow: 0 4px 14px var(--jp-gold-border);
  transition: transform var(--jp-motion-fast) var(--jp-ease-standard), box-shadow var(--jp-motion-fast) var(--jp-ease-standard);
}
.login-btn-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px var(--jp-gold-border);
}
.login-btn-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.back-to-login-link {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--jp-text-muted);
  text-decoration: none;
  transition: color var(--jp-motion-fast) var(--jp-ease-standard);
}
.back-to-login-link:hover {
  color: var(--jp-text-emphasis);
}

.login-security-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 10px;
  color: var(--jp-text-subtle);
}

.login-footer {
  margin-top: 18px;
  font-size: 10px;
  color: var(--jp-text-subtle);
  letter-spacing: 0.4px;
}
</style>

