<template>
  <v-container fluid class="fill-height login-shell">
    <v-row align="center" justify="center">
      <v-col cols="12" sm="8" md="5" lg="4">
        <v-card class="pa-6 pa-md-8 login-card" elevation="8">
          <div class="text-center mb-6">
            <v-icon size="48" color="primary">mdi-diamond-stone</v-icon>
            <h1 class="text-h5 font-weight-bold mt-3">Jeweler Pro</h1>
            <p class="text--secondary mb-0">Yönetim paneline giriş yapın</p>
          </div>
          <v-form @submit.prevent="login">
            <v-text-field v-model.trim="email" label="E-posta" type="email" autocomplete="username" outlined required />
            <v-text-field v-model="password" label="Şifre" type="password" autocomplete="current-password" outlined required />
            <v-alert v-if="error" type="error" dense text>{{ error }}</v-alert>
            <v-btn type="submit" color="primary" block large :loading="loading" :disabled="!email || !password">
              Güvenli giriş
            </v-btn>
          </v-form>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
import apiService from '@/services/api';

export default {
  name: 'LoginPage',
  data: () => ({ email: '', password: '', loading: false, error: '' }),
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
.login-shell { min-height: 100vh; background: linear-gradient(135deg, #141e30, #243b55); }
.login-card { border-radius: 18px; }
</style>
