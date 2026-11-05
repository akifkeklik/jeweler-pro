<template>
  <v-container fluid class="fill-height login-shell">
    <div class="login-glow login-glow-one"></div><div class="login-glow login-glow-two"></div>
    <v-row align="center" justify="center" class="login-row">
      <v-col cols="12" sm="8" md="5" lg="4" xl="3">
        <div class="login-brand">
          <div class="login-mark"><v-icon color="white" size="31">mdi-diamond-stone</v-icon></div>
          <div><div class="login-brand-name">JEWELER <span>PRO</span></div><div class="login-brand-caption">BUSINESS MANAGEMENT</div></div>
        </div>
        <v-card class="pa-6 pa-md-8 login-card" elevation="0">
          <div class="login-heading">
            <div class="login-kicker">HOŞ GELDİNİZ</div>
            <h1>Hesabınıza giriş yapın</h1>
            <p>İşletme yönetim panelinize güvenli erişim sağlayın.</p>
          </div>
          <v-form @submit.prevent="login">
            <label class="field-label">E-posta adresi</label>
            <v-text-field v-model.trim="email" placeholder="ornek@isletme.com" type="email" autocomplete="username" outlined dense hide-details="auto" class="login-field" required />
            <label class="field-label mt-5">Şifre</label>
            <v-text-field v-model="password" placeholder="Şifrenizi girin" type="password" autocomplete="current-password" outlined dense hide-details="auto" class="login-field" required />
            <v-alert v-if="error" type="error" dense text class="mt-4">{{ error }}</v-alert>
            <v-btn type="submit" block large depressed class="login-submit mt-7" :loading="loading" :disabled="!email || !password">
              Güvenli giriş <v-icon right small>mdi-arrow-right</v-icon>
            </v-btn>
          </v-form>
          <div class="login-security"><v-icon small>mdi-shield-check-outline</v-icon> Güvenli ve şifrelenmiş oturum</div>
        </v-card>
        <div class="login-copyright">© {{ year }} JEWELER PRO <span>•</span> Tüm hakları saklıdır</div>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
import apiService from '@/services/api';

export default {
  name: 'LoginPage',
  data: () => ({ email: '', password: '', loading: false, error: '', year: new Date().getFullYear() }),
  methods: {
    async login() {
      this.loading = true;
      this.error = '';
      try {
        const result = await apiService.post('/api/auth/login', { email: this.email, password: this.password });
        sessionStorage.setItem('jeweler_token', result.token);
        sessionStorage.setItem('jeweler_user', JSON.stringify(result.user));
        const destination = this.$route.query.redirect || '/dashboard';
        this.$router.replace(destination);
      } catch (error) {
        this.error = error.message || 'Giriş yapılamadı. Bilgilerinizi kontrol edin.';
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>

<style scoped>
.login-shell { position:relative; min-height:100vh; overflow:hidden; background:#080d17; }
.login-row { position:relative; z-index:1; }
.login-glow { position:absolute; width:420px; height:420px; border-radius:50%; filter:blur(100px); opacity:.16; pointer-events:none; }
.login-glow-one { top:-210px; right:-80px; background:#176fe1; }
.login-glow-two { bottom:-260px; left:-130px; background:#0b9b91; }
.login-brand { display:flex; align-items:center; justify-content:center; gap:13px; margin-bottom:25px; }
.login-mark { display:grid; place-items:center; width:52px; height:52px; border-radius:15px; background:linear-gradient(145deg,#1676ee,#1244a7); box-shadow:0 10px 30px rgba(22,118,238,.3); }
.login-brand-name { color:#f5f8ff; font:800 17px 'Manrope',sans-serif; letter-spacing:1.5px; }
.login-brand-name span { color:#62a8ff; }
.login-brand-caption { margin-top:4px; color:#74849d; font-size:9px; letter-spacing:1.5px; font-weight:700; }
.login-card { border:1px solid rgba(148,163,184,.15) !important; border-radius:16px !important; background:linear-gradient(145deg,#111d30,#0d1625) !important; box-shadow:0 25px 70px rgba(0,0,0,.35) !important; }
.login-kicker { color:#6daeff; font-size:9px; font-weight:800; letter-spacing:1.6px; }
.login-heading h1 { margin:9px 0 7px; color:#f2f6fc; font:800 23px 'Manrope',sans-serif; letter-spacing:-.5px; }
.login-heading p { margin-bottom:27px; color:#8797ae; font-size:11px; line-height:1.6; }
.field-label { display:block; margin-bottom:7px; color:#aab8ca; font-size:10px; font-weight:700; }
.login-field >>> .v-input__slot { min-height:44px !important; background:rgba(255,255,255,.025) !important; border-radius:8px !important; }
.login-field >>> fieldset { border-color:rgba(148,163,184,.2) !important; }
.login-field >>> input { color:#e8eff9 !important; font-size:12px; }
.login-field >>> input::placeholder { color:#687a93 !important; }
.login-submit { height:45px !important; border-radius:8px !important; color:white !important; background:linear-gradient(135deg,#287be8,#1454b8) !important; font-size:11px !important; font-weight:700 !important; text-transform:none !important; }
.login-security { display:flex; align-items:center; justify-content:center; gap:7px; margin-top:21px; color:#71839b; font-size:9px; }
.login-security .v-icon { color:#36bd91; }
.login-copyright { margin-top:22px; text-align:center; color:#53647d; font-size:9px; letter-spacing:.4px; }
.login-copyright span { margin:0 5px; color:#287be8; }
</style>