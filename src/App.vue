<template>
  <v-app class="jeweler-app">
    <v-navigation-drawer
      v-if="$route.path !== '/login'"
      v-model="drawer"
      app
      :permanent="$vuetify.breakpoint.mdAndUp"
      :temporary="$vuetify.breakpoint.smAndDown"
      width="252"
      class="jeweler-sidebar"
    >
      <div class="brand-lockup">
        <div class="brand-mark"><v-icon color="white" size="25">mdi-diamond-stone</v-icon></div>
        <div>
          <div class="brand-name">JEWELER <span>PRO</span></div>
          <div class="brand-caption">BUSINESS MANAGEMENT</div>
        </div>
      </div>

      <div class="sidebar-search">
        <v-icon small>mdi-magnify</v-icon>
        <input v-model.trim="navSearch" type="search" placeholder="Menüde ara" aria-label="Menüde ara" />
        <kbd>/</kbd>
      </div>

      <div v-for="group in filteredNavGroups" :key="group.label" class="nav-group">
        <div class="nav-label">{{ group.label }}</div>
        <v-list dense nav class="nav-list">
          <v-list-item
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            link
            class="nav-item"
            active-class="nav-item-active"
            @click="closeMobileDrawer"
          >
            <v-list-item-icon><v-icon>{{ item.icon }}</v-icon></v-list-item-icon>
            <v-list-item-content><v-list-item-title>{{ item.title }}</v-list-item-title></v-list-item-content>
            <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
          </v-list-item>
        </v-list>
      </div>

      <div class="sidebar-bottom">
        <div class="sidebar-status"><span class="status-dot"></span> Sistem hazır</div>
        <div class="profile-row">
          <div class="profile-avatar">{{ userInitials }}</div>
          <div class="profile-copy">
            <strong>{{ userName }}</strong>
            <span>Yönetici hesabı</span>
          </div>
          <v-btn icon small class="profile-logout" title="Çıkış yap" @click="logout"><v-icon small>mdi-logout</v-icon></v-btn>
        </div>
      </div>
    </v-navigation-drawer>

    <v-app-bar v-if="$route.path !== '/login'" app flat height="72" class="jeweler-topbar">
      <v-app-bar-nav-icon class="mobile-menu" @click="drawer = !drawer"></v-app-bar-nav-icon>
      <div class="topbar-context">
        <div class="topbar-eyebrow">İŞLETME YÖNETİMİ</div>
        <div class="topbar-title">{{ currentPageTitle }}</div>
      </div>
      <v-spacer></v-spacer>
      <div class="topbar-date d-none d-sm-flex">
        <v-icon small class="mr-2">mdi-calendar-blank-outline</v-icon>
        {{ todayLabel }}
      </div>
      <v-btn icon class="topbar-icon" title="Koyu tema" @click="toggleDarkMode">
        <v-icon>{{ darkMode ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>
      <v-btn class="topbar-create d-none d-sm-flex" depressed @click="$router.push('/sales')">
        <v-icon left small>mdi-plus</v-icon> Yeni satış
      </v-btn>
    </v-app-bar>

    <v-main v-if="$route.path !== '/login'" class="jeweler-main">
      <v-container fluid class="page-container">
        <router-view />
      </v-container>
    </v-main>
    <v-main v-else class="login-main"><router-view /></v-main>

    <div v-if="$route.path !== '/login'" class="notification-container">
      <v-slide-y-transition group>
        <div v-for="notification in notifications" :key="notification.id" class="notification-item" :class="'notification-' + notification.type">
          <v-icon small class="mr-2">{{ getNotificationIcon(notification.type) }}</v-icon>
          <span>{{ notification.message }}</span>
          <v-btn icon x-small class="ml-2" @click="$store.dispatch('notifications/removeNotification', notification.id)"><v-icon x-small>mdi-close</v-icon></v-btn>
        </div>
      </v-slide-y-transition>
    </div>
  </v-app>
</template>

<script>
export default {
  name: 'App',
  data() {
    return {
      drawer: true,
      darkMode: true,
      navSearch: '',
      navGroups: [
        { label: 'GENEL', items: [
          { title: 'Genel Bakış', icon: 'mdi-view-dashboard-outline', path: '/dashboard' },
          { title: 'Piyasa & Değerler', icon: 'mdi-chart-line', path: '/prices' },
        ]},
        { label: 'İŞLETME', items: [
          { title: 'Satışlar', icon: 'mdi-receipt-text-outline', path: '/sales' },
          { title: 'Ürün & Stok', icon: 'mdi-diamond-stone', path: '/products' },
          { title: 'Müşteriler', icon: 'mdi-account-group-outline', path: '/customers' },
        ]},
        { label: 'ANALİZ & ARAÇLAR', items: [
          { title: 'Raporlar', icon: 'mdi-chart-box-outline', path: '/reports' },
          { title: 'Hesap Makinesi', icon: 'mdi-calculator-variant-outline', path: '/calculator' },
        ]}
      ]
    };
  },
  computed: {
    filteredNavGroups() {
      const query = this.navSearch.toLocaleLowerCase('tr-TR');
      if (!query) return this.navGroups;
      return this.navGroups
        .map(group => ({ ...group, items: group.items.filter(item => item.title.toLocaleLowerCase('tr-TR').includes(query)) }))
        .filter(group => group.items.length > 0);
    },
    notifications() { return this.$store.state.notifications.notifications || []; },
    userName() {
      try {
        const user = JSON.parse(sessionStorage.getItem('jeweler_user') || '{}');
        return user.name || user.email || 'Yönetici';
      } catch (error) { return 'Yönetici'; }
    },
    userInitials() {
      return this.userName.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || 'YP';
    },
    currentPageTitle() {
      const titles = { '/dashboard': 'Genel Bakış', '/prices': 'Piyasa & Değerler', '/sales': 'Satış Yönetimi', '/products': 'Ürün & Stok', '/customers': 'Müşteri Yönetimi', '/reports': 'Raporlar', '/calculator': 'Hesap Makinesi' };
      return titles[this.$route.path] || 'Yönetim Paneli';
    },
    todayLabel() {
      return new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
    }
  },
  mounted() {
    try {
      const saved = localStorage.getItem('themeDark');
      this.darkMode = saved === null ? true : saved === 'true';
      this.$vuetify.theme.dark = this.darkMode;
    } catch (error) {
      this.darkMode = true;
      this.$vuetify.theme.dark = true;
    }
    if (this.$vuetify.breakpoint.smAndDown) this.drawer = false;
  },
  methods: {
    toggleDarkMode() {
      this.darkMode = !this.darkMode;
      this.$vuetify.theme.dark = this.darkMode;
      try { localStorage.setItem('themeDark', String(this.darkMode)); } catch (error) { /* storage unavailable */ }
    },
    closeMobileDrawer() {
      if (this.$vuetify.breakpoint.smAndDown) this.drawer = false;
    },
    logout() {
      sessionStorage.removeItem('jeweler_token');
      sessionStorage.removeItem('jeweler_user');
      this.$router.replace('/login');
    },
    getNotificationIcon(type) {
      const icons = { success: 'mdi-check-circle', error: 'mdi-alert-circle', warning: 'mdi-alert', info: 'mdi-information' };
      return icons[type] || 'mdi-information';
    }
  }
};
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap');

:root { color-scheme: dark; }
html { overflow-y: auto; }
.v-application { font-family: 'DM Sans', sans-serif !important; background: #080d17 !important; }
.v-application .headline, .v-application .text-h4, .v-application .text-h5 { font-family: 'Manrope', sans-serif !important; }
.jeweler-app { background: #080d17 !important; color: #e8edf7; }
.jeweler-sidebar { background: #0c1321 !important; border-right: 1px solid rgba(148,163,184,.12) !important; color: #dbe4f2 !important; }
.jeweler-sidebar .v-navigation-drawer__content { display:flex; flex-direction:column; padding: 0 15px 14px; }
.brand-lockup { display:flex; align-items:center; gap:12px; padding:25px 8px 26px; border-bottom:1px solid rgba(148,163,184,.10); }
.brand-mark { width:42px; height:42px; display:grid; place-items:center; border-radius:13px; background:linear-gradient(145deg,#1676ee,#1244a7); box-shadow:0 8px 22px rgba(22,118,238,.28); }
.brand-name { font:800 15px 'Manrope',sans-serif; letter-spacing:1.2px; color:#f5f8ff; }
.brand-name span { color:#62a8ff; }
.brand-caption { margin-top:3px; font-size:8px; letter-spacing:1.45px; color:#73829a; font-weight:700; }
.sidebar-search { height:39px; margin:18px 2px 22px; padding:0 11px; display:flex; align-items:center; gap:9px; color:#8290a7; border:1px solid rgba(148,163,184,.14); border-radius:9px; background:rgba(255,255,255,.025); font-size:12px; }
.sidebar-search input { min-width:0; width:100%; border:0; outline:0; color:#dbe4f2; background:transparent; font:12px 'DM Sans',sans-serif; }
.sidebar-search input::placeholder { color:#8290a7; opacity:1; }
.sidebar-search input::-webkit-search-cancel-button { cursor:pointer; }
.sidebar-search kbd { margin-left:auto; padding:2px 5px; border:1px solid rgba(148,163,184,.2); border-radius:4px; color:#8290a7; font:10px 'DM Sans',sans-serif; }
.nav-group { margin-bottom:17px; }
.nav-label { padding:0 10px 8px; color:#62718a; font-size:9px; font-weight:700; letter-spacing:1.5px; }
.nav-list { padding:0 !important; }
.nav-item { min-height:42px !important; margin:2px 0; padding:0 10px !important; border-radius:9px !important; color:#9ba9bd !important; }
.nav-item .v-icon { color:#8292aa !important; font-size:19px !important; }
.nav-item .v-list-item__title { font-size:12px !important; font-weight:600; }
.nav-item-active { color:#fff !important; background:linear-gradient(100deg,rgba(29,112,232,.28),rgba(29,112,232,.08)) !important; box-shadow:inset 2px 0 #3489ff; }
.nav-item-active .v-icon { color:#68adff !important; }
.nav-badge { font-size:10px; color:#9ccaff; background:rgba(40,126,235,.18); border-radius:5px; padding:2px 6px; }
.sidebar-bottom { margin-top:auto; }
.sidebar-status { display:flex; align-items:center; gap:8px; padding:12px 10px; margin-bottom:10px; color:#7f8ea5; font-size:10px; border-top:1px solid rgba(148,163,184,.10); }
.status-dot { width:7px; height:7px; border-radius:50%; background:#31c48d; box-shadow:0 0 10px rgba(49,196,141,.5); }
.profile-row { display:flex; align-items:center; gap:10px; padding:11px 8px; border:1px solid rgba(148,163,184,.12); border-radius:11px; background:rgba(255,255,255,.025); }
.profile-avatar { width:32px; height:32px; display:grid; place-items:center; border-radius:9px; color:#d7e9ff; background:#1b3d68; font-size:11px; font-weight:700; }
.profile-copy { min-width:0; display:flex; flex:1; flex-direction:column; }
.profile-copy strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#e5edf8; font-size:11px; }
.profile-copy span { color:#718199; font-size:9px; margin-top:2px; }
.profile-logout { color:#8292aa !important; }
.jeweler-topbar { background:rgba(10,16,28,.94) !important; border-bottom:1px solid rgba(148,163,184,.12) !important; padding:0 26px; backdrop-filter:blur(16px); }
.topbar-context { display:flex; flex-direction:column; gap:3px; }
.topbar-eyebrow { color:#687991; font-size:9px; font-weight:700; letter-spacing:1.4px; }
.topbar-title { color:#f2f6fc; font:700 16px 'Manrope',sans-serif; }
.topbar-date { align-items:center; color:#8190a6; font-size:11px; margin-right:18px; text-transform:capitalize; }
.topbar-icon { color:#a5b3c7 !important; margin:0 3px; }
.topbar-create { height:37px !important; margin-left:14px; padding:0 15px !important; color:white !important; border-radius:8px !important; text-transform:none !important; font-size:11px !important; font-weight:700 !important; background:linear-gradient(135deg,#287be8,#1454b8) !important; box-shadow:0 5px 16px rgba(28,105,220,.22) !important; }
.jeweler-main { min-height:100vh; background:radial-gradient(ellipse at 88% 0%,rgba(25,79,143,.13),transparent 34%),#080d17 !important; }
.page-container { max-width:1600px; padding:30px 34px 48px !important; }
.login-main { background:#080d17 !important; }
.mobile-menu { color:#a5b3c7 !important; }
.notification-container { position:fixed; top:84px; right:20px; z-index:1000; max-width:400px; display:flex; flex-direction:column; gap:10px; }
.notification-item { display:flex; align-items:center; padding:12px 15px; border-radius:9px; box-shadow:0 8px 24px rgba(0,0,0,.25); min-height:44px; font-size:12px; }
.notification-success { background:#126b50; color:white; } .notification-error { background:#9f3038; color:white; } .notification-warning { background:#93601a; color:white; } .notification-info { background:#205f9e; color:white; }
.v-application--is-dark .v-card { background:#101a2a !important; color:#e6edf7 !important; border:1px solid rgba(148,163,184,.12); box-shadow:0 12px 30px rgba(0,0,0,.16) !important; }
.v-application--is-dark .v-data-table { background:transparent !important; color:#dce5f2 !important; }
.v-application--is-dark .v-data-table th { color:#8595ad !important; border-bottom:1px solid rgba(148,163,184,.15) !important; }
.v-application--is-dark .v-data-table td { border-bottom:1px solid rgba(148,163,184,.08) !important; }
.v-application--is-dark .v-data-table tr:hover { background:rgba(255,255,255,.025) !important; }
@media(max-width:600px) { .page-container { padding:20px 15px 34px !important; } .jeweler-topbar { padding:0 8px; } }
</style>