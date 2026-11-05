<template>
  <div class="dashboard-page">
    <div class="page-heading">
      <div>
        <div class="eyebrow">GENEL BAKIŞ <span class="live-dot"></span> CANLI PANEL</div>
        <h1>İşletmenizin kontrol merkezi</h1>
        <p>Satışlarınızı, müşteri hareketlerinizi ve işletme performansınızı tek ekrandan takip edin.</p>
      </div>
      <div class="heading-actions">
        <v-btn outlined class="date-filter" @click="loadSummary"><v-icon left small>mdi-refresh</v-icon> Yenile</v-btn>
        <v-btn depressed class="primary-action" @click="$router.push('/sales')"><v-icon left small>mdi-plus</v-icon> Yeni satış</v-btn>
      </div>
    </div>

    <v-alert v-if="error" dense text type="warning" class="dashboard-alert">{{ error }}</v-alert>

    <div class="section-heading"><span>İŞLETME ÖZETİ</span><small>Satış kayıtlarından hesaplanır</small></div>
    <v-row class="metric-grid">
      <v-col cols="12" sm="6" xl="3">
        <div class="metric-card">
          <div class="metric-top"><span>Toplam ciro</span><div class="metric-icon blue"><v-icon>mdi-wallet-outline</v-icon></div></div>
          <div class="metric-value">{{ summary ? money(summary.totalRevenue) : '—' }}</div>
          <div class="metric-foot"><span class="metric-note">İptal edilen satışlar hariç</span></div>
        </div>
      </v-col>
      <v-col cols="12" sm="6" xl="3">
        <div class="metric-card">
          <div class="metric-top"><span>Brüt kâr</span><div class="metric-icon green"><v-icon>mdi-chart-areaspline</v-icon></div></div>
          <div class="metric-value">{{ summary && summary.profitDataComplete ? money(summary.totalProfit) : '—' }}</div>
          <div class="metric-foot"><span class="metric-note">{{ summary && summary.profitDataComplete ? 'Maliyet bilgisi tam' : 'Tam maliyet verisi bekleniyor' }}</span></div>
        </div>
      </v-col>
      <v-col cols="12" sm="6" xl="3">
        <div class="metric-card">
          <div class="metric-top"><span>Satılan adet</span><div class="metric-icon violet"><v-icon>mdi-package-variant-closed</v-icon></div></div>
          <div class="metric-value">{{ summary ? number(summary.totalQuantity) : '—' }}</div>
          <div class="metric-foot"><span class="metric-note">Tamamlanan satış kayıtları</span></div>
        </div>
      </v-col>
      <v-col cols="12" sm="6" xl="3">
        <div class="metric-card">
          <div class="metric-top"><span>Aktif müşteri</span><div class="metric-icon amber"><v-icon>mdi-account-group-outline</v-icon></div></div>
          <div class="metric-value">{{ summary ? number(summary.totalCustomers) : '—' }}</div>
          <div class="metric-foot"><span class="metric-note">Satış kaydı bulunan müşteri</span></div>
        </div>
      </v-col>
    </v-row>

    <v-row class="mt-1">
      <v-col cols="12" lg="7">
        <div class="panel-card market-panel">
          <div class="panel-heading">
            <div><div class="panel-kicker">PİYASA TAKİBİ</div><h2>Altın & döviz değerleri</h2></div>
            <v-btn text small class="panel-link" @click="$router.push('/prices')">Piyasayı görüntüle <v-icon right small>mdi-arrow-right</v-icon></v-btn>
          </div>
          <div class="market-content">
            <div class="market-symbol"><v-icon>mdi-chart-line</v-icon></div>
            <div><strong>Piyasa ekranına geçin</strong><span>Altın, sarrafiye ve döviz alış / satış fiyatlarını takip edin.</span></div>
            <v-btn icon class="market-arrow" @click="$router.push('/prices')"><v-icon>mdi-arrow-top-right</v-icon></v-btn>
          </div>
          <div class="market-foot"><span><i></i> Fiyat verileri bağlı kaynaktan görüntülenir</span><span>Detaylı fiyat tablosu <v-icon x-small>mdi-chevron-right</v-icon></span></div>
        </div>
      </v-col>
      <v-col cols="12" lg="5">
        <div class="panel-card shortcuts-panel">
          <div class="panel-heading"><div><div class="panel-kicker">HIZLI ERİŞİM</div><h2>İşlemler</h2></div></div>
          <div class="shortcut-list">
            <button v-for="action in shortcuts" :key="action.path" class="shortcut-row" @click="$router.push(action.path)">
              <span class="shortcut-icon" :class="action.tone"><v-icon>{{ action.icon }}</v-icon></span>
              <span class="shortcut-copy"><strong>{{ action.title }}</strong><small>{{ action.subtitle }}</small></span>
              <v-icon class="shortcut-chevron">mdi-chevron-right</v-icon>
            </button>
          </div>
        </div>
      </v-col>
    </v-row>
    <div class="dashboard-footer"><span>JEWELER PRO <b>•</b> İşletme yönetim platformu</span><span>Son kontrol: {{ lastUpdated || '—' }}</span></div>
  </div>
</template>

<script>
import apiService from '@/services/api';

export default {
  name: 'DashboardPage',
  data() {
    return {
      summary: null,
      error: '',
      lastUpdated: '',
      shortcuts: [
        { title: 'Satış oluştur', subtitle: 'Yeni satış ve işlem kaydı', icon: 'mdi-receipt-text-plus-outline', path: '/sales', tone: 'blue' },
        { title: 'Ürünleri yönet', subtitle: 'Ürün kataloğu ve stok durumu', icon: 'mdi-diamond-stone', path: '/products', tone: 'violet' },
        { title: 'Müşteriler', subtitle: 'Müşteri kayıtlarına ulaşın', icon: 'mdi-account-multiple-outline', path: '/customers', tone: 'green' },
        { title: 'Raporlar', subtitle: 'İşletme performansını inceleyin', icon: 'mdi-chart-box-outline', path: '/reports', tone: 'amber' }
      ]
    };
  },
  mounted() { this.loadSummary(); },
  methods: {
    async loadSummary() {
      this.error = '';
      try {
        this.summary = await apiService.get('/api/dashboard/summary');
        this.lastUpdated = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
      } catch (error) {
        this.error = error.message || 'İşletme özeti şu anda alınamıyor.';
      }
    },
    money(value) {
      return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(Number(value) || 0);
    },
    number(value) { return new Intl.NumberFormat('tr-TR').format(Number(value) || 0); }
  }
};
</script>

<style scoped>
.dashboard-page { color:#e6edf7; }
.page-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; margin:3px 0 31px; }
.eyebrow,.panel-kicker { color:#6e819d; font-size:9px; font-weight:800; letter-spacing:1.55px; }
.live-dot { display:inline-block; width:6px; height:6px; margin:0 5px 1px 9px; border-radius:50%; background:#35c995; box-shadow:0 0 9px rgba(53,201,149,.65); }
.page-heading h1 { margin:10px 0 7px; color:#f4f7fc; font:800 clamp(23px,3vw,30px) 'Manrope',sans-serif; letter-spacing:-.8px; }
.page-heading p { margin:0; color:#8392a9; font-size:12px; }
.heading-actions { display:flex; gap:9px; flex-shrink:0; }
.date-filter { color:#9aabc1 !important; border-color:rgba(148,163,184,.2) !important; border-radius:8px !important; text-transform:none !important; font-size:11px !important; }
.primary-action { color:white !important; background:linear-gradient(135deg,#287be8,#1454b8) !important; border-radius:8px !important; text-transform:none !important; font-size:11px !important; font-weight:700 !important; }
.section-heading { display:flex; align-items:center; gap:12px; margin-bottom:12px; color:#a2b0c4; font-size:10px; font-weight:800; letter-spacing:1.2px; }
.section-heading:after { content:''; height:1px; flex:1; background:rgba(148,163,184,.12); }
.section-heading small { color:#65758d; font-size:10px; font-weight:400; letter-spacing:0; text-transform:none; }
.metric-grid { margin:0 -7px 13px !important; }
.metric-grid > .v-col { padding:7px !important; }
.metric-card,.panel-card { height:100%; border:1px solid rgba(148,163,184,.13); border-radius:13px; background:linear-gradient(145deg,#111d30,#0e1726); box-shadow:0 10px 28px rgba(0,0,0,.12); }
.metric-card { padding:18px 19px 15px; min-height:142px; }
.metric-top { display:flex; justify-content:space-between; align-items:center; color:#91a0b6; font-size:11px; font-weight:600; }
.metric-icon { display:grid; place-items:center; width:34px; height:34px; border-radius:10px; }
.metric-icon .v-icon { font-size:18px; }
.metric-icon.blue,.shortcut-icon.blue { color:#69adff; background:rgba(46,130,239,.14); }
.metric-icon.green,.shortcut-icon.green { color:#48d5a0; background:rgba(43,190,137,.13); }
.metric-icon.violet,.shortcut-icon.violet { color:#b49aff; background:rgba(145,108,237,.14); }
.metric-icon.amber,.shortcut-icon.amber { color:#f2bd64; background:rgba(225,161,60,.13); }
.metric-value { margin:13px 0 8px; color:#f2f6fc; font:800 25px 'Manrope',sans-serif; letter-spacing:-.7px; }
.metric-foot { display:flex; align-items:center; gap:6px; }
.metric-note { color:#6f8099; font-size:10px; }
.panel-card { padding:20px; }
.panel-heading { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.panel-heading h2 { margin:5px 0 0; color:#eaf0f9; font:700 15px 'Manrope',sans-serif; }
.panel-link { color:#6eafff !important; text-transform:none !important; font-size:10px !important; }
.market-content { display:flex; align-items:center; gap:14px; margin:22px 0 17px; padding:17px; border:1px solid rgba(148,163,184,.11); border-radius:10px; background:rgba(255,255,255,.018); }
.market-symbol { display:grid; place-items:center; width:42px; height:42px; flex-shrink:0; color:#70b4ff; border-radius:11px; background:rgba(43,127,229,.14); }
.market-content > div:nth-child(2) { display:flex; flex-direction:column; gap:5px; flex:1; }
.market-content strong { color:#e5edf8; font-size:12px; }
.market-content span { color:#8191a8; font-size:10px; line-height:1.5; }
.market-arrow { color:#7c8ca4 !important; }
.market-foot { display:flex; justify-content:space-between; gap:10px; color:#71829a; font-size:9px; }
.market-foot i { display:inline-block; width:6px; height:6px; margin-right:5px; border-radius:50%; background:#34c995; }
.market-foot .v-icon { color:#71829a; vertical-align:middle; }
.shortcuts-panel { min-height:100%; }
.shortcut-list { margin-top:12px; }
.shortcut-row { display:flex; align-items:center; width:100%; gap:11px; padding:10px 2px; text-align:left; border-bottom:1px solid rgba(148,163,184,.09); cursor:pointer; }
.shortcut-row:last-child { border-bottom:0; }
.shortcut-row:hover .shortcut-chevron { color:#75b5ff; transform:translateX(3px); }
.shortcut-icon { display:grid; place-items:center; width:34px; height:34px; flex-shrink:0; border-radius:9px; }
.shortcut-icon .v-icon { font-size:18px; }
.shortcut-copy { display:flex; flex:1; flex-direction:column; gap:3px; }
.shortcut-copy strong { color:#dce6f4; font-size:11px; font-weight:600; }
.shortcut-copy small { color:#71829a; font-size:9px; }
.shortcut-chevron { color:#65758d; font-size:17px; transition:all .2s; }
.dashboard-footer { display:flex; justify-content:space-between; margin-top:24px; color:#53637b; font-size:9px; }
.dashboard-footer b { color:#287be8; margin:0 4px; }
.dashboard-alert { background:rgba(194,137,43,.12) !important; border:1px solid rgba(194,137,43,.2); color:#e8c17b !important; }
@media(max-width:700px) { .page-heading { align-items:flex-start; flex-direction:column; } .heading-actions { width:100%; } .dashboard-footer { flex-direction:column; gap:7px; } .market-foot { flex-direction:column; } }
</style>