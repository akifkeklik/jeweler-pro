<template>
  <v-app>
    <!-- Üst Bar (App Bar) -->
    <v-app-bar app flat class="app-bar">
      <v-app-bar-nav-icon @click="drawer = !drawer" class="menu-btn"></v-app-bar-nav-icon>

      <v-toolbar-title>
        <v-icon left class="diamond-icon">mdi-diamond-stone</v-icon>
        <span class="ml-2 font-weight-bold">KALE KUYUMCULUK TİC. LTD. ŞTİ.</span>
      </v-toolbar-title>

      <v-spacer></v-spacer>

      <!-- Gece Modu Toggle Butonu -->
      <v-btn icon class="dark-toggle" @click="toggleDarkMode">
        <v-icon>{{ darkMode ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>
    </v-app-bar>

    <!-- Sidebar -->
    <v-navigation-drawer
        v-model="drawer"
        app
        class="modern-sidebar"
    >
      <v-list dense nav>
        <!-- Menü Linkleri -->
        <v-list-item
            v-for="item in items"
            :key="item.title"
            :to="item.path"
            link
            class="sidebar-link"
        >
          <v-list-item-icon><v-icon>{{ item.icon }}</v-icon></v-list-item-icon>
          <v-list-item-title>{{ item.title }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-navigation-drawer>

    <!-- İçerik -->
    <v-main>
      <v-container fluid class="pa-6 fill-height" :class="[darkMode ? 'dark-bg' : 'light-bg']">
        <router-view />
      </v-container>
    </v-main>

    <!-- Değerler Butonu (Tüm Sayfalarda Görünür) -->
    <v-btn
        class="floating-values-btn"
        @click="goToPrices"
        fab
        large
        dark
    >
      DEĞERLER
    </v-btn>
  </v-app>
</template>

<script>
export default {
  name: "App",
  data() {
    return {
      drawer: false, // Sidebar başlangıçta kapalı
      darkMode: true, // Gece modu default
      items: [
        { title: "Ana Sayfa", icon: "mdi-home", path: "/dashboard" },
        { title: "Değerler", icon: "mdi-cash", path: "/prices" },
        { title: "Satışlar", icon: "mdi-cart", path: "/sales" },
        { title: "Ürünler", icon: "mdi-cube", path: "/products" },
        { title: "Müşteriler", icon: "mdi-account-group", path: "/customers" },
        { title: "Raporlar", icon: "mdi-chart-line", path: "/reports" },
        { title: "Hesap Makinesi", icon: "mdi-calculator", path: "/calculator" }

      ]
    };
  },
  methods: {
    toggleDarkMode() {
      this.darkMode = !this.darkMode;
    },
    goToPrices() {
      this.drawer = false;
      this.$router.push('/prices');
    }
  }
};
</script>

<style>
.v-application {
  font-family: "Segoe UI", Roboto, Arial, sans-serif;
}

/* === APP BAR MODERN === */
.app-bar {
  background: linear-gradient(90deg, #141e30, #243b55) !important;
  color: #C0C0C0 !important;
  font-family: 'Cinzel', serif;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
.diamond-icon {
  color: #C0C0C0 !important;
  font-size: 28px;
}
.menu-btn {
  color: #C0C0C0 !important;
}
.dark-toggle {
  color: #C0C0C0 !important;
  transition: 0.3s ease;
}
.dark-toggle:hover {
  transform: rotate(15deg);
  color: #B0B0B0 !important;
}

/* === SIDEBAR MODERN === */
.modern-sidebar {
  background: linear-gradient(90deg, #141e30, #243b55) !important;
  color: #C0C0C0 !important;
  box-shadow: 4px 0px 15px rgba(0, 0, 0, 0.1);
}
.modern-sidebar .v-list-item,
.modern-sidebar .v-icon {
  color: #C0C0C0 !important;
}
.sidebar-link {
  transition: 0.3s ease;
  border-radius: 8px;
  color: #C0C0C0 !important;
  font-family: 'Cinzel', serif;
  font-weight: 600;
}
.sidebar-link:hover {
  background: linear-gradient(90deg, rgba(192,192,192,0.2), transparent);
  box-shadow: inset 2px 0 0 #C0C0C0;
}

/* === SAYFA BACKGROUND === */
.light-bg {
  background: linear-gradient(135deg, #e6f2f8, #f0faff) !important;
  color: #222 !important;
}
.dark-bg {
  background: linear-gradient(135deg, #141e30, #0f2027) !important;
  color: #f5f5f5 !important;
}

/* === GLOBAL KART STİLİ === */
.v-card {
  border-radius: 20px !important;
  overflow: hidden;
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.08) !important;
  transition: 0.3s;
  display: flex;
  flex-direction: column;
  background: #fdfdfd !important;
}

/* === DEĞERLER BUTONU === */
.floating-values-btn {
  position: fixed !important;
  bottom: 12px !important;
  right: 12px !important;
  z-index: 999;
  background: rgba(20, 30, 48, 0.4) !important;
  backdrop-filter: blur(6px);
  font-family: 'Cinzel', serif !important;
  font-weight: bold !important;
  letter-spacing: 1px !important;
  text-transform: uppercase !important;
  border-radius: 12px !important;
  width: 80px !important;
  height: 40px !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
  transition: all 0.3s ease !important;
  opacity: 0.8;
  font-size: 12px !important;
}

.floating-values-btn:hover {
  background: rgba(36, 59, 85, 0.85) !important;
  transform: translateY(-5px);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35) !important;
  opacity: 1;
}
</style>
