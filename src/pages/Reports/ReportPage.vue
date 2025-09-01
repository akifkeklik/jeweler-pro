<template>
  <v-container fluid class="py-6">

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
            <span>{{ Math.abs(kpi.trend) }}%</span>
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
      return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n || 0);
    },
    sumTotal(list) {
      return list.reduce((t, o) => t + (o.totalPrice || 0), 0);
    },
    sumKar(list) {
      return list.reduce((t, o) => t + (o.kar || 0), 0);
    },
    trend(current, prev) {
      if (!prev || prev === 0) return 100;
      return Math.round(((current - prev) / prev) * 100);
    },
    async loadReports() {
      try {
        this.dayOrders = await fetch("http://localhost:5000/api/reports/daily").then(r=>r.json());
        this.weekOrders = await fetch("http://localhost:5000/api/reports/weekly").then(r=>r.json());
        this.monthOrders = await fetch("http://localhost:5000/api/reports/monthly").then(r=>r.json());
        this.prevMonthOrders = await fetch("http://localhost:5000/api/reports/monthly?prev=1").then(r=>r.json());
        this.topSellersMonth = await fetch("http://localhost:5000/api/reports/top-sellers").then(r=>r.json());
        this.lowStock = await fetch("http://localhost:5000/api/reports/low-stock").then(r=>r.json());
        this.customers = await fetch("http://localhost:5000/api/customers").then(r=>r.json());

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
* { font-family: "Inter", "Roboto", sans-serif; }
.v-row { align-items: stretch !important; }
.v-col { display: flex; flex-direction: column; }

.report-card,
.kpi-card {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  border-radius: 16px;
  background: #fff;
  color: #333;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  transition: 0.3s;
}

.kpi-value { font-size: 2rem; font-weight: bold; color: #1976d2; }
.kpi-title { font-size: 0.95rem; color: #1976d2; margin-bottom: 8px; }
.kpi-trend { font-size: 0.9rem; font-weight: 600; }
.trend-up { color: #4caf50; }
.trend-down { color: #f44336; }

.v-data-table {
  flex: 1; border-radius: 12px; background: #fafafa;
  color: #444; font-size: 0.9rem;
}
.v-data-table thead {
  background: #f5f5f5; font-weight: bold; color: #333;
}
.v-data-table tbody tr:hover {
  background: rgba(26, 119, 213, 0.08);
}

.summary-bar {
  background: #f5f5f5; border-radius: 8px; padding: 10px 14px;
  margin-top: 8px; color: #222; font-weight: 600;
  font-size: 0.9rem; text-align: right;
}
</style>
