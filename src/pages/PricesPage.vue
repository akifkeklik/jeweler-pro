<template>
  <div class="market-page">
    <header class="market-hero">
      <div>
        <div class="market-eyebrow"><span class="market-eyebrow-dot"></span> PİYASA MERKEZİ</div>
        <h1>Canlı piyasa verileri</h1>
        <p>Resmî döviz kurları ve işletmenizin tanımlı kıymetli maden fiyatları tek ekranda.</p>
      </div>
      <div class="market-hero-actions">
        <div class="market-updated" v-if="lastUpdated">
          <span class="market-updated-dot" :class="{ 'is-error': !!error }"></span>
          Son kontrol {{ lastUpdated }}
        </div>
        <v-btn depressed class="market-refresh" :loading="loading" @click="fetchPrices">
          <v-icon left small>mdi-refresh</v-icon> Yenile
        </v-btn>
      </div>
    </header>

    <v-alert v-if="error" type="warning" dense text class="market-alert">
      {{ error }}
    </v-alert>

    <section class="market-source-grid">
      <article class="market-source-card">
        <div class="market-source-icon"><v-icon>mdi-bank</v-icon></div>
        <div class="market-source-copy">
          <strong>TCMB döviz kurları</strong>
          <span>Türkiye Cumhuriyet Merkez Bankası · USD, EUR, GBP, AUD</span>
        </div>
        <v-chip small :color="currencies.length ? 'success' : 'warning'" text-color="white">
          {{ currencies.length ? 'Veri alındı' : 'Veri bekleniyor' }}
        </v-chip>
      </article>
      <article class="market-source-card">
        <div class="market-source-icon market-source-icon-gold"><v-icon>mdi-gold</v-icon></div>
        <div class="market-source-copy">
          <strong>İşletme fiyat havuzu</strong>
          <span>Veritabanında yönetici tarafından tanımlanan alış / satış fiyatları</span>
        </div>
        <v-chip small :color="metalPrices.length ? 'success' : 'default'" text-color="white">
          {{ metalPrices.length ? metalPrices.length + ' kayıt' : 'Kayıt yok' }}
        </v-chip>
      </article>
      <article class="market-source-card market-source-card-muted">
        <div class="market-source-icon"><v-icon>mdi-chart-candlestick</v-icon></div>
        <div class="market-source-copy">
          <strong>Borsa İstanbul</strong>
          <span>Lisanslı piyasa veri sağlayıcısı entegrasyonu henüz yapılandırılmadı.</span>
        </div>
        <v-chip small color="warning" text-color="white">Bağlı değil</v-chip>
      </article>
    </section>

    <section class="market-section">
      <div class="market-section-heading">
        <div>
          <div class="market-section-kicker">RESMÎ KAYNAK</div>
          <h2>Döviz kurları</h2>
        </div>
        <span class="market-section-meta">Alış / satış · TL karşılığı</span>
      </div>
      <v-card flat class="market-table-card">
        <v-data-table
          :headers="currencyHeaders"
          :items="currencies"
          :loading="loading && !currencies.length"
          hide-default-footer
          disable-pagination
          class="market-data-table"
          no-data-text="TCMB verisi şu anda alınamıyor."
        >
          <template v-slot:item.currency="{ item }">
            <div class="market-instrument">
              <span class="market-instrument-symbol">{{ item.currency.split('/')[0] }}</span>
              <strong>{{ item.currency }}</strong>
            </div>
          </template>
          <template v-slot:item.buyPrice="{ item }">
            <span class="market-number">{{ formatPrice(item.buyPrice) }}</span>
          </template>
          <template v-slot:item.sellPrice="{ item }">
            <span class="market-number">{{ formatPrice(item.sellPrice) }}</span>
          </template>
        </v-data-table>
      </v-card>
      <p class="market-footnote">TCMB kurları resmî referans niteliğindedir; kuyumcu ekranındaki anlık serbest piyasa alış / satış fiyatlarıyla aynı olmayabilir.</p>
    </section>

    <section class="market-section">
      <div class="market-section-heading">
        <div>
          <div class="market-section-kicker">İŞLETME TANIMLARI</div>
          <h2>Kıymetli maden & sarrafiye</h2>
        </div>
        <span class="market-section-meta">MongoDB fiyat kayıtları</span>
      </div>
      <v-card flat class="market-table-card">
        <v-data-table
          :headers="metalHeaders"
          :items="metalPrices"
          :loading="loading && !metalPrices.length"
          hide-default-footer
          disable-pagination
          class="market-data-table"
          no-data-text="Henüz kıymetli maden veya sarrafiye fiyatı tanımlanmamış."
        >
          <template v-slot:item.type="{ item }">
            <div class="market-instrument">
              <span class="market-instrument-symbol market-instrument-gold"><v-icon small>mdi-gold</v-icon></span>
              <strong>{{ item.type }}</strong>
            </div>
          </template>
          <template v-slot:item.buy="{ item }"><span class="market-number">{{ formatPrice(item.buy) }}</span></template>
          <template v-slot:item.sell="{ item }"><span class="market-number">{{ formatPrice(item.sell) }}</span></template>
          <template v-slot:item.createdAt="{ item }"><span class="market-date">{{ formatDate(item.createdAt) }}</span></template>
        </v-data-table>
      </v-card>
      <p class="market-footnote">Bu bölümdeki değerler harici canlı piyasa verisi olarak sunulmaz; veritabanındaki işletme fiyat kayıtlarıdır.</p>
    </section>
  </div>
</template>

<script>
import apiService from '@/services/api';

export default {
  name: 'PricesPage',
  data() {
    return {
      loading: false,
      error: '',
      lastUpdated: '',
      currencies: [],
      metalPrices: [],
      refreshTimer: null,
      currencyHeaders: [
        { text: 'Enstrüman', value: 'currency', sortable: false },
        { text: 'Alış (₺)', value: 'buyPrice', align: 'end', sortable: false },
        { text: 'Satış (₺)', value: 'sellPrice', align: 'end', sortable: false },
      ],
      metalHeaders: [
        { text: 'Varlık', value: 'type', sortable: false },
        { text: 'Alış (₺)', value: 'buy', align: 'end', sortable: false },
        { text: 'Satış (₺)', value: 'sell', align: 'end', sortable: false },
        { text: 'Kayıt tarihi', value: 'createdAt', align: 'end', sortable: false },
      ],
    };
  },
  mounted() {
    this.fetchPrices();
    // TCMB feed is not a tick-by-tick exchange feed. Refresh conservatively.
    this.refreshTimer = setInterval(this.fetchPrices, 60000);
  },
  beforeDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  },
  methods: {
    async fetchPrices() {
      if (this.loading) return;
      this.loading = true;
      this.error = '';
      try {
        const data = await apiService.get('/api/prices');
        this.currencies = Array.isArray(data.currencies) ? data.currencies : [];
        this.metalPrices = Array.isArray(data.prices) ? data.prices : [];
        this.lastUpdated = new Intl.DateTimeFormat('tr-TR', {
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).format(new Date());
        if (!this.currencies.length) {
          this.error = 'TCMB kaynağından döviz verisi alınamadı. Son geçerli fiyat varmış gibi gösterim yapılmıyor.';
        }
      } catch (error) {
        this.error = error.message || 'Piyasa verileri API üzerinden alınamadı.';
      } finally {
        this.loading = false;
      }
    },
    formatPrice(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '—';
      return new Intl.NumberFormat('tr-TR', {
        minimumFractionDigits: 2, maximumFractionDigits: 4,
      }).format(number);
    },
    formatDate(value) {
      if (!value) return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '—';
      return new Intl.DateTimeFormat('tr-TR', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }).format(date);
    },
  },
};
</script>

<style scoped>
.market-page { color:var(--jp-text, #e8eef8); }
.market-hero { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; margin:4px 0 28px; }
.market-eyebrow,.market-section-kicker { display:flex; align-items:center; gap:8px; color:#8293ad; font-size:9px; font-weight:800; letter-spacing:1.55px; }
.market-eyebrow-dot,.market-updated-dot { width:7px; height:7px; border-radius:50%; background:#36c58b; box-shadow:0 0 12px rgba(54,197,139,.5); }
.market-hero h1 { margin:10px 0 7px; color:inherit; font:800 clamp(25px,3vw,34px)/1.2 'Manrope',sans-serif; letter-spacing:-1.1px; }
.market-hero p { max-width:650px; margin:0; color:#91a0b7; font-size:13px; line-height:1.7; }
.market-hero-actions { display:flex; align-items:center; gap:16px; }
.market-updated { display:flex; align-items:center; gap:8px; color:#8797ad; font-size:11px; white-space:nowrap; }
.market-updated-dot.is-error { background:#e3a64b; box-shadow:0 0 10px rgba(227,166,75,.35); }
.market-refresh { color:#fff !important; background:linear-gradient(135deg,#398bfa,#175bb8) !important; padding:0 16px !important; }
.market-alert { margin-bottom:20px; }
.market-source-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-bottom:34px; }
.market-source-card { min-width:0; display:flex; align-items:center; gap:12px; padding:16px; border:1px solid rgba(148,163,184,.14); border-radius:14px; background:linear-gradient(145deg,rgba(20,34,54,.94),rgba(14,24,39,.94)); }
.market-source-card-muted { opacity:.82; }
.market-source-icon,.market-instrument-symbol { flex:0 0 auto; width:38px; height:38px; display:grid; place-items:center; border-radius:11px; color:#8dbfff; background:rgba(57,139,250,.13); }
.market-source-icon-gold,.market-instrument-gold { color:#e5c17f; background:rgba(214,173,104,.13); }
.market-source-copy { min-width:0; flex:1; display:flex; flex-direction:column; gap:4px; }
.market-source-copy strong { color:#e7eef9; font-size:12px; font-weight:750; }
.market-source-copy span { color:#8797ad; font-size:10px; line-height:1.5; }
.market-section { margin-top:28px; }
.market-section-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:13px; }
.market-section-heading h2 { margin:5px 0 0; color:inherit; font:750 19px 'Manrope',sans-serif; letter-spacing:-.45px; }
.market-section-meta { color:#8292a9; font-size:10px; }
.market-table-card { padding:6px 12px; background:linear-gradient(145deg,#121e30,#0f1928) !important; }
.market-data-table { background:transparent !important; }
.market-instrument { display:flex; align-items:center; gap:11px; }
.market-instrument-symbol { width:31px; height:31px; border-radius:9px; font-size:10px; font-weight:800; }
.market-instrument strong { color:#e3ebf7; font-size:12px; font-weight:700; }
.market-number { color:#e6edf8; font:700 12px 'DM Sans',sans-serif; font-variant-numeric:tabular-nums; }
.market-date { color:#8998ad; font-size:11px; }
.market-footnote { margin:10px 3px 0; color:#7e8da4; font-size:10px; line-height:1.6; }
.v-application--is-light .market-page { color:#172338; }
.v-application--is-light .market-hero h1,.v-application--is-light .market-section-heading h2 { color:#172338; }
.v-application--is-light .market-hero p,.v-application--is-light .market-updated,.v-application--is-light .market-section-meta,.v-application--is-light .market-footnote { color:#64748b; }
.v-application--is-light .market-source-card { background:#fff; border-color:#e5eaf2; }
.v-application--is-light .market-source-copy strong,.v-application--is-light .market-instrument strong,.v-application--is-light .market-number { color:#172338; }
.v-application--is-light .market-table-card { background:#fff !important; }
@media(max-width:960px) { .market-source-grid { grid-template-columns:1fr; } }
@media(max-width:650px) {
  .market-hero { align-items:flex-start; flex-direction:column; }
  .market-hero-actions { width:100%; justify-content:space-between; }
  .market-section-heading { align-items:flex-start; flex-direction:column; gap:5px; }
  .market-source-card { padding:13px; }
}
</style>
