<template>
  <v-app>
    <!-- Üst AppBar -->
    <v-app-bar app :color="isDark ? 'indigo-darken-4' : 'indigo-darken-3'" dark>
      <v-app-bar-nav-icon></v-app-bar-nav-icon>
      <v-toolbar-title class="font-weight-bold">Jewelers Pro</v-toolbar-title>
      <v-spacer></v-spacer>

      <!-- Global Arama -->
      <v-text-field
        v-model="globalQuery"
        placeholder="Ara (ürün/müşteri)"
        prepend-inner-icon="mdi-magnify"
        hide-details
        dense
        solo-inverted
        flat
        class="mr-2"
        @keyup.enter="applySearch"
      />

      <!-- Dark Mode Toggle -->
      <v-btn icon :title="isDark ? 'Açık tema' : 'Koyu tema'" @click="toggleDark">
        <v-icon>{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>
      <v-btn icon>
        <v-icon>mdi-bell</v-icon>
      </v-btn>
      <v-btn icon>
        <v-icon>mdi-account-circle</v-icon>
      </v-btn>
    </v-app-bar>

    <!-- Yan Menü -->
    <v-navigation-drawer app :color="isDark ? 'indigo-darken-4' : 'indigo-lighten-5'">
      <v-list>
        <v-list-item :to="{ name: 'Dashboard' }" link>
          <v-list-item-icon><v-icon color="indigo">mdi-view-dashboard</v-icon></v-list-item-icon>
          <v-list-item-title>Dashboard</v-list-item-title>
        </v-list-item>

        <v-list-item :to="{ name: 'Reports' }" link>
          <v-list-item-icon><v-icon color="indigo">mdi-file-chart</v-icon></v-list-item-icon>
          <v-list-item-title>Raporlar</v-list-item-title>
        </v-list-item>

        <v-list-item :to="{ name: 'Products' }" link>
          <v-list-item-icon><v-icon color="indigo">mdi-cube-outline</v-icon></v-list-item-icon>
          <v-list-item-title>Ürünler</v-list-item-title>
        </v-list-item>

        <v-list-item :to="{ name: 'Customers' }" link>
          <v-list-item-icon><v-icon color="indigo">mdi-account-group</v-icon></v-list-item-icon>
          <v-list-item-title>Müşteriler</v-list-item-title>
        </v-list-item>

        <v-list-item :to="{ name: 'Sales' }" link>
          <v-list-item-icon><v-icon color="indigo">mdi-cart-outline</v-icon></v-list-item-icon>
          <v-list-item-title>Satışlar</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-navigation-drawer>

    <!-- İçerik -->
    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

  <script>
  import vuetify from '@/plugins/vuetify';
  import { applySettings, loadSettings, persistSettings } from '@/services/settings';

  export default {
    setup() {
      return { theme: vuetify.theme };
    },
    data() {
      return {
        globalQuery: this.$route.query.q || ''
      };
    },
    computed: {
      isDark() {
        return this.theme.global.name.value === 'dark';
      }
    },
    mounted() {
      const settings = loadSettings();
      applySettings(settings);
      this.theme.change(settings.themeMode === 'dark' ? 'dark' : 'light');
    },
    methods: {
      toggleDark() {
        const next = !this.isDark;
        this.theme.change(next ? 'dark' : 'light');
        const settings = loadSettings();
        persistSettings({ ...settings, themeMode: next ? 'dark' : 'light' });
      },
      applySearch() {
        // Mevcut route'a query ile uygula
        const q = this.globalQuery || undefined;
        this.$router.replace({ query: { ...this.$route.query, q } });
      }
    },
    watch: {
      // Route değişince arama kutusunu senkronize tut
      '$route.query.q'(val) {
        this.globalQuery = val || '';
      }
    }
  }
  </script>
