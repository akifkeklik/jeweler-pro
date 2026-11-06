<template>
  <v-container fluid class="reports-page py-2">
    <header class="page-heading"><div><div class="eyebrow">ANALİZ / PERFORMANS</div><h1>İşletme raporları</h1><p>Günlük, haftalık ve aylık satış performansınızı işlem kayıtlarından izleyin.</p></div><v-btn outlined class="refresh-action" @click="loadReports"><v-icon left small>mdi-refresh</v-icon> Raporları yenile</v-btn></header>

    <!-- ✅ KPI Kartları -->
    <v-row dense class="mb-6">
      <v-col cols="12" md="3" v-for="kpi in kpis" :key="kpi.title">
        <v-card outlined class="pa-6 text-center kpi-card">
          <v-icon x-large class="mb-3" :color="kpi.color">{{ kpi.icon }}</v-icon>
          <h2 class="kpi-value">{{ kpi.value }}</h2>
          <p class="kpi-title">{{ kpi.title }}</p>

          <div class="kpi-trend mt-2" :class="kpi.trend >= 0 ? 'trend-up' : 'trend-down'">
            <v-icon small left>
              {{ kpi.trend >= 0 ? 'mdi-arrow-up-bold' : 'mdi-arrow-down-bold' }}
            </v-icon>
            <span v-if="kpi.trend !== null">{{ Math.abs(kpi.trend) }}%</span><span v-else>Yeni dönem</span>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Günlük Rapor -->
    <v-row dense>
      <v-col cols="12" md="6">
        <v-card outlined class="report-card">
          <v-card-title class="subtitle-1 font-weight-bold card-title">GÜNLÜK RAPOR (Tablo)</v-card-title>
          <v-data-table :headers="orderHeaders" :items="dayOrders" dense hide-default-footer>
            <template v-slot:item.totalPrice="{ item }">{{ tl(item.totalPrice) }}</template>
            <template v-slot:item.kar="{ item }">{{ tl(item.kar) }}</template>
          </v-data-table>
          <v-divider/>
          <div class="summary-bar">
            Toplam Satış: {{ dayOrders.length }} |
            Ciro: {{ tl(sumTotal(dayOrders)) }} |
            Kâr: {{ tl(sumKar(dayOrders)) }}
          </div>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card outlined class="report-card">
          <v-card-title class="subtitle-1 font-weight-bold card-title">GÜNLÜK RAPOR (Grafik)</v-card-title>
          <apexchart type="bar" height="250" :options="dailyOptions" :series="dailySeries"/>
        </v-card>
      </v-col>
    </v-row>

    <!-- Haftalık ve Aylık -->
    <v-row dense class="mt-4">
      <v-col cols="12" md="6">
        <v-card outlined class="report-card">
          <v-card-title class="subtitle-1 font-weight-bold card-title">HAFTALIK RAPOR</v-card-title>
          <v-data-table :headers="orderHeaders" :items="weekOrders" dense hide-default-footer>
            <template v-slot:item.totalPrice="{ item }">{{ tl(item.totalPrice) }}</template>
            <template v-slot:item.kar="{ item }">{{ tl(item.kar) }}</template>
          </v-data-table>
          <v-divider/>
          <div class="summary-bar">
            Ciro: {{ tl(sumTotal(weekOrders)) }} | Kâr: {{ tl(sumKar(weekOrders)) }}
          </div>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card outlined class="report-card">
          <v-card-title class="subtitle-1 font-weight-bold card-title">AYLIK RAPOR</v-card-title>
          <v-data-table :headers="orderHeaders" :items="monthOrders" dense hide-default-footer>
            <template v-slot:item.totalPrice="{ item }">{{ tl(item.totalPrice) }}</template>
            <template v-slot:item.kar="{ item }">{{ tl(item.kar) }}</template>
          </v-data-table>
          <v-divider/>
          <div class="summary-bar">
            Ciro: {{ tl(sumTotal(monthOrders)) }} | Kâr: {{ tl(sumKar(monthOrders)) }}
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- En Çok Satılanlar & Az Stok -->
    <v-row dense class="mt-4">
      <v-col cols="12" md="6">
        <v-card outlined class="report-card">
          <v-card-title class="subtitle-1 font-weight-bold card-title">BU AY EN ÇOK SATILANLAR</v-card-title>
          <v-data-table :headers="topsHeaders" :items="topSellersMonth" dense hide-default-footer>
            <template v-slot:item.ciro="{ item }">{{ tl(item.ciro) }}</template>
            <template v-slot:item.kar="{ item }">{{ tl(item.kar) }}</template>
          </v-data-table>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card outlined class="report-card">
          <v-card-title class="subtitle-1 font-weight-bold card-title">AZ KALAN STOK!</v-card-title>
          <v-data-table :headers="lowHeaders" :items="lowStock" dense hide-default-footer>
            <template v-slot:item.stok="{ item }">
              <v-chip :color="item.stok <= 0 ? 'blue' : item.stok <= 5 ? 'grey' : 'green'" text-color="white" small>
                <v-icon left small>
                  {{ item.stok <= 0 ? 'mdi-alert-circle' : item.stok <= 5 ? 'mdi-alert' : 'mdi-check-circle' }}
                </v-icon>
                {{ item.stok }}
              </v-chip>
            </template>
          </v-data-table>
        </v-card>
      </v-col>
    </v-row>

  </v-container>
</template>

<script>
import VueApexCharts from "vue-apexcharts";
import apiService from "@/services/api";

export default {
  name: "RaporlarPage",
  components: { apexchart: VueApexCharts },
  data() {
    return {
      orderHeaders: [
        { text: "No", value: "_id", width: 70 },
        { text: "Tarih", value: "date", width: 110 },
        { text: "Ürün", value: "productName" },
        { text: "Adet", value: "quantity", align: "right", width: 70 },
        { text: "Tutar", value: "totalPrice", align: "right", width: 120 },
        { text: "Kâr", value: "kar", align: "right", width: 120 },
      ],
      topsHeaders: [
        { text: "Ürün", value: "urun" },
        { text: "Adet", value: "adet", align: "right", width: 80 },
        { text: "Ciro", value: "ciro", align: "right", width: 120 },
        { text: "Kâr", value: "kar", align: "right", width: 120 },
      ],
      lowHeaders: [
        { text: "Ürün", value: "isim" },
        { text: "Stok", value: "stok", align: "right", width: 90 },
      ],

      dayOrders: [],
      weekOrders: [],
      monthOrders: [],
      prevMonthOrders: [],
      topSellersMonth: [],
      lowStock: [],
      customers: [],

      dailyOptions: {
        chart: { toolbar: { show: false } },
        plotOptions: { bar: { borderRadius: 6 } },
        dataLabels: { enabled: true },
        colors: ["#1E3A8A"],
        xaxis: { categories: [] },
      },
      dailySeries: [{ name: "Ciro", data: [] }]
    };
  },
  computed: {
    kpis() {
      const toplamCiro = this.sumTotal(this.monthOrders);
      const toplamKar = this.sumKar(this.monthOrders);
      const toplamAdet = this.monthOrders.reduce((t,o)=>t+(o.quantity||0),0);
      const toplamMusteri = this.customers.length;

      // Geçen ay kıyaslama
      const prevCiro = this.sumTotal(this.prevMonthOrders);
      const prevKar = this.sumKar(this.prevMonthOrders);
      const prevAdet = this.prevMonthOrders.reduce((t,o)=>t+(o.quantity||0),0);
      const prevMusteri = this.customers.filter(c => {
        const created = new Date(c.createdAt);
        const now = new Date();
        const firstDayPrevMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);
        const lastDayPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        return created >= firstDayPrevMonth && created <= lastDayPrevMonth;
      }).length;

      return [
        { title: "Toplam Ciro", value: this.tl(toplamCiro), icon: "mdi-cash", color: "grey", trend: this.trend(toplamCiro, prevCiro) },
        { title: "Toplam Kâr", value: this.tl(toplamKar), icon: "mdi-trending-up", color: "blue", trend: this.trend(toplamKar, prevKar) },
        { title: "Toplam Satış Adedi", value: toplamAdet, icon: "mdi-cart", color: "deep-purple", trend: this.trend(toplamAdet, prevAdet) },
        { title: "Toplam Müşteri", value: toplamMusteri, icon: "mdi-account-group", color: "#1E3A8A", trend: this.trend(toplamMusteri, prevMusteri) },
      ];
    }
  },
  mounted() {
    this.loadReports();
  },
  methods: {
    tl(n) {
      if (n === null || n === undefined) return "Maliyet verisi eksik";
      return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);
    },
    sumTotal(list) {
      return list.reduce((t, o) => t + (o.totalPrice || 0), 0);
    },
    sumKar(list) {
      if (list.some((o) => o.kar === null || o.kar === undefined)) return null;
      return list.reduce((t, o) => t + o.kar, 0);
    },
    trend(current, prev) {
      if (prev === 0) return current === 0 ? 0 : null;
      return Math.round(((current - prev) / prev) * 100);
    },
    async loadReports() {
      try {
        const [day, week, month, prevMonth, top, low, customers] = await Promise.all([
          apiService.get("/api/reports/daily"),
          apiService.get("/api/reports/weekly"),
          apiService.get("/api/reports/monthly"),
          apiService.get("/api/reports/monthly?prev=1"),
          apiService.get("/api/reports/top-sellers"),
          apiService.get("/api/reports/low-stock"),
          apiService.get("/api/customers"),
        ]);

        this.dayOrders = day;
        this.weekOrders = week;
        this.monthOrders = month;
        this.prevMonthOrders = prevMonth;
        this.topSellersMonth = top;
        this.lowStock = low;
        this.customers = customers;

        this.dailyOptions.xaxis.categories = this.dayOrders.map(d =>
            new Date(d.date).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
        );
        this.dailySeries[0].data = this.dayOrders.map(d => d.totalPrice);
      } catch (e) {
        console.error("Rapor verileri yüklenemedi:", e);
      }
    }
  }
};
</script>


<style scoped>
.reports-page { color:#e6edf7; }
.page-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin:4px 0 23px; }
.eyebrow { color:#71839d; font-size:9px; font-weight:800; letter-spacing:1.45px; }
.page-heading h1 { margin:9px 0 6px; color:#f2f6fc; font:800 clamp(23px,3vw,29px) 'Manrope',sans-serif; letter-spacing:-.7px; }
.page-heading p { margin:0; color:#8292a9; font-size:12px; }
.refresh-action { height:39px !important; color:#a9bad0 !important; border-color:rgba(148,163,184,.2) !important; border-radius:8px !important; text-transform:none !important; font-size:11px !important; }
.v-row { align-items:stretch !important; }
.v-col { display:flex; flex-direction:column; }
.report-card,.kpi-card { flex:1; height:100%; display:flex; flex-direction:column; justify-content:space-between; border:1px solid rgba(148,163,184,.13) !important; border-radius:12px !important; background:linear-gradient(145deg,#111d30,#0e1726) !important; color:#dce5f1 !important; box-shadow:none !important; }
.kpi-card { min-height:155px; align-items:flex-start; padding:19px !important; }
.kpi-value { margin:4px 0 3px; color:#f2f6fc; font:800 22px 'Manrope',sans-serif; }
.kpi-title { margin:0; color:#8b9bb1; font-size:10px; }
.kpi-trend { display:flex; align-items:center; font-size:10px; font-weight:700; }
.trend-up { color:#48d5a0; }
.trend-down { color:#f08b8b; }
.card-title { min-height:53px; color:#dce5f1 !important; font-size:11px !important; font-weight:800 !important; letter-spacing:.5px; border-bottom:1px solid rgba(148,163,184,.1); }
.report-card >>> .v-data-table { flex:1; background:transparent !important; color:#dce5f1 !important; font-size:10px; }
.report-card >>> .v-data-table-header th { color:#8292a9 !important; background:rgba(255,255,255,.018); font-size:9px !important; text-transform:uppercase; letter-spacing:.5px; }
.report-card >>> tbody td { color:#aebbd0 !important; border-bottom-color:rgba(148,163,184,.08) !important; }
.report-card >>> tbody tr:hover { background:rgba(63,133,220,.055) !important; }
.summary-bar { margin:8px 12px 12px; padding:10px 12px; border:1px solid rgba(148,163,184,.1); border-radius:7px; background:rgba(255,255,255,.025); color:#aab8ca; font-size:10px; font-weight:600; text-align:right; }
@media(max-width:600px) { .page-heading { align-items:flex-start; flex-direction:column; } }
</style>