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

      <!-- Login Card -->
      <div v-if="!showForgotPassword" class="login-card jp-card">
        <div class="login-header">
          <span class="login-kicker">{{ $t('auth.kicker') }}</span>
          <h1 class="login-title">{{ $t('auth.title') }}</h1>
          <p class="login-subtitle">{{ $t('auth.subtitle') }}</p>
        </div>

        <form class="login-form mt-4" @submit.prevent="login">
          <div class="form-group">
            <label class="form-label" for="login-email">{{ $t('auth.email') }}</label>
            <div class="input-with-icon">
              <v-icon size="16" class="field-icon">mdi-email-outline</v-icon>
              <input
                id="login-email"
                v-model.trim="email"
                type="email"
                :placeholder="$t('auth.emailPlaceholder')"
                class="login-input"
                autocomplete="username"
                required
              />
            </div>
          </div>

          <div class="form-group mt-3">
            <label class="form-label" for="login-password">{{ $t('auth.password') }}</label>
            <div class="input-with-icon">
              <v-icon size="16" class="field-icon">mdi-lock-outline</v-icon>
              <input
                id="login-password"
                v-model="password"
                type="password"
                placeholder="••••••••"
                class="login-input"
                autocomplete="current-password"
                required
              />
            </div>
          </div>

          <!-- Remember Me & Forgot Password Row -->
          <div class="d-flex align-center justify-space-between mt-3 px-1">
            <label
              class="remember-me-toggle"
              :title="$t('auth.rememberHint')"
            >
              <input
                v-model="rememberMe"
                type="checkbox"
                class="remember-checkbox"
                data-testid="remember-me"
              />
              <span class="remember-label">{{ $t('auth.rememberMe') }}</span>
            </label>

            <button
              type="button"
              class="forgot-password-link"
              @click="openForgotPassword"
            >
              {{ $t('auth.forgot') }}
            </button>
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

          <v-alert
            v-if="successNotice"
            density="compact"
            type="success"
            variant="tonal"
            class="mt-3 py-1 text-caption"
            closable
            @click:close="successNotice = ''"
          >
            {{ successNotice }}
          </v-alert>

          <button
            type="submit"
            class="login-btn-submit mt-4 jp-primary"
            :disabled="loading || !email || !password"
          >
            <v-progress-circular
              v-if="loading"
              indeterminate
              size="16"
              width="2"
              class="mr-2"
            />
            <v-icon v-else start size="16">mdi-shield-lock-outline</v-icon>
            {{ $t('auth.submit') }}
          </button>
        </form>

        <div class="login-security-badge mt-4">
          <v-icon size="13" class="badge-icon-ok">mdi-shield-check</v-icon>
          <span v-if="rememberMe">{{ $t('auth.persistentNote') }}</span>
          <span v-else>{{ $t('auth.browserNote') }}</span>
        </div>
      </div>

      <!-- Forgot Password Card -->
      <div v-else class="login-card jp-card">
        <div class="login-header">
          <span class="login-kicker">{{ $t('auth.forgotKicker') }}</span>
          <h1 class="login-title">{{ $t('auth.forgotTitle') }}</h1>
          <p class="login-subtitle">{{ $t('auth.forgotSubtitle') }}</p>
        </div>

        <form class="login-form mt-4" @submit.prevent="requestPasswordReset">
          <div class="form-group">
            <label class="form-label" for="forgot-email">{{ $t('auth.forgotEmail') }}</label>
            <div class="input-with-icon">
              <v-icon size="16" class="field-icon">mdi-email-outline</v-icon>
              <input
                id="forgot-email"
                v-model.trim="forgotEmail"
                type="email"
                :placeholder="$t('auth.emailPlaceholder')"
                class="login-input"
                autocomplete="email"
                required
              />
            </div>
          </div>

          <v-alert
            v-if="forgotError"
            density="compact"
            type="error"
            variant="tonal"
            class="mt-3 py-1 text-caption"
            closable
            @click:close="forgotError = ''"
          >
            {{ forgotError }}
          </v-alert>

          <v-alert
            v-if="forgotSuccess"
            density="compact"
            type="success"
            variant="tonal"
            class="mt-3 py-1 text-caption"
          >
            {{ forgotSuccess }}
          </v-alert>

          <button
            type="submit"
            class="login-btn-submit mt-4 jp-primary"
            :disabled="forgotLoading || !forgotEmail"
          >
            <v-progress-circular
              v-if="forgotLoading"
              indeterminate
              size="16"
              width="2"
              class="mr-2"
            />
            <v-icon v-else start size="16">mdi-email-send-outline</v-icon>
            {{ $t('auth.sendLink') }}
          </button>

          <button
            type="button"
            class="back-to-login-btn mt-3"
            @click="showForgotPassword = false"
          >
            <v-icon size="14" class="mr-1 flip-rtl">mdi-arrow-left</v-icon>
            {{ $t('auth.backToLogin') }}
          </button>
        </form>

        <div class="login-security-badge mt-4">
          <v-icon size="13" class="badge-icon-warn">mdi-lock-clock</v-icon>
          <span>{{ $t('auth.linkNote') }}</span>
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
import { login as authLogin, safeRedirectPath } from '@/services/authSession';
import { t } from '@/i18n';
import AuthPreferences from '@/components/AuthPreferences.vue';

export default {
  name: 'LoginPage',
  components: { AuthPreferences },
  data: () => ({
    email: '',
    password: '',
    rememberMe: false,
    loading: false,
    error: '',
    successNotice: '',
    showForgotPassword: false,
    forgotEmail: '',
    forgotLoading: false,
    forgotError: '',
    forgotSuccess: '',
    year: new Date().getFullYear(),
  }),
  mounted() {
    if (this.$route.query.reset === 'success') {
      this.successNotice = t('auth.resetSuccess');
    } else if (this.$route.query.expired === '1') {
      this.error = t('errors.sessionExpired');
    }
    if (this.$route.query.forgot === '1') {
      this.openForgotPassword();
    }
  },
  methods: {
    async login() {
      this.loading = true;
      this.error = '';
      this.successNotice = '';
      try {
        await authLogin(this.email, this.password, this.rememberMe);
        this.password = '';
        this.$router.replace(safeRedirectPath(this.$route.query.redirect));
      } catch (err) {
        this.error = err.status === 429
          ? t('auth.rateLimited')
          : (err.message || t('errors.loginFailed'));
      } finally {
        this.loading = false;
      }
    },
    openForgotPassword() {
      this.forgotEmail = this.email || '';
      this.forgotError = '';
      this.forgotSuccess = '';
      this.showForgotPassword = true;
    },
    async requestPasswordReset() {
      this.forgotLoading = true;
      this.forgotError = '';
      this.forgotSuccess = '';
      try {
        const res = await apiService.post('/api/auth/forgot-password', {
          email: this.forgotEmail,
        });
        // The server's text is Turkish-only, so the localized message is shown.
        void res;
        this.forgotSuccess = t('auth.forgotSent');
      } catch (err) {
        if (err.code === 'SMTP_UNCONFIGURED') {
          this.forgotError = t('auth.smtpUnconfigured');
        } else if (err.code === 'SMTP_UNAVAILABLE') {
          this.forgotError = t('auth.smtpUnavailable');
        } else if (err.status === 429) {
          this.forgotError = t('auth.tooManyRequests');
        } else {
          this.forgotError = err.message || t('auth.forgotFailed');
        }
      } finally {
        this.forgotLoading = false;
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
  color: var(--jp-gold);
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

.remember-me-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.remember-checkbox {
  accent-color: var(--jp-gold);
  cursor: pointer;
  width: 14px;
  height: 14px;
}
.remember-label {
  font-size: 11px;
  color: var(--jp-text-muted);
}
.remember-me-toggle:hover .remember-label {
  color: var(--jp-text-emphasis);
}

.forgot-password-link {
  background: none;
  border: 0;
  color: var(--jp-gold);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  transition: opacity var(--jp-motion-fast) var(--jp-ease-standard);
}
.forgot-password-link:hover {
  text-decoration: underline;
  opacity: 0.85;
}

.back-to-login-btn {
  width: 100%;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  color: var(--jp-text-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--jp-motion-fast) var(--jp-ease-standard), border-color var(--jp-motion-fast) var(--jp-ease-standard), color var(--jp-motion-fast) var(--jp-ease-standard), box-shadow var(--jp-motion-fast) var(--jp-ease-standard), opacity var(--jp-motion-fast) var(--jp-ease-standard);
}
.back-to-login-btn:hover {
  background: var(--jp-surface-muted);
  color: var(--jp-text-emphasis);
  border-color: var(--jp-border-light);
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
