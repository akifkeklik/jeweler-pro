<template>
  <div class="jp-page-shell reports-page-shell">
    <!-- Header -->
    <div class="jp-page-header">
      <div class="page-heading-left">
        <div>
          <div class="jp-section-label">{{ $t('reports.performansVeFinansalAnalitik') }}</div>
          <h1 class="page-title">
            <v-icon size="20" color="primary">mdi-chart-areaspline</v-icon>
            {{ $t('reports.raporlamaAnaliz') }}
          </h1>
        </div>
      </div>
      <div class="header-actions">
        <!-- Period Toggle -->
        <div class="period-toggle-group">
          <button
            type="button"
            class="period-btn"
            :class="{ active: selectedPeriod === 'daily' }"
            @click="selectedPeriod = 'daily'"
          >
            {{ $t('reports.gunluk') }}
          </button>
          <button
            type="button"
            class="period-btn"
            :class="{ active: selectedPeriod === 'weekly' }"
            @click="selectedPeriod = 'weekly'"
          >
            {{ $t('reports.haftalik') }}
          </button>
          <button
            type="button"
            class="period-btn"
            :class="{ active: selectedPeriod === 'monthly' }"
            @click="selectedPeriod = 'monthly'"
          >
            {{ $t('reports.aylik') }}
          </button>
        </div>

        <v-btn
          size="small"
          class="jp-secondary"
          :loading="loading"
          @click="loadReports"
        >
          <v-icon start size="14">mdi-refresh</v-icon>
          {{ $t('common.refresh') }}
        </v-btn>
      </div>
    </div>

    <!-- Error Alert if any -->
    <v-alert
      v-if="error"
      density="compact"
      type="error"
      variant="tonal"
      class="mb-2 py-1 text-caption"
      closable
      @click:close="error = ''"
    >
      {{ error }}
    </v-alert>

    <!-- KPI Ribbon -->
    <div class="reports-kpi-row">
      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-info);">
          <v-icon size="18">mdi-cash-multiple</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('reports.p0Ciro', { p0: periodLabel }) }}</span>
          <div class="jp-stat-value tabular">{{ tl(currentPeriodCiro) }}</div>
          <div v-if="kpiTrends.ciro !== undefined" class="kpi-trend" :class="trendClass(kpiTrends.ciro)" :title="$t('reports.trendVsPrevMonth')">
            <v-icon size="12">{{ trendIcon(kpiTrends.ciro) }}</v-icon>
            <span v-if="kpiTrends.ciro !== null" class="tabular">{{ $n(Math.abs(kpiTrends.ciro)) }}%</span><span v-else>{{ $t('reports.trendNoBaseline') }}</span>
          </div>
        </div>
      </div>

      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-success);">
          <v-icon size="18">mdi-trending-up</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('reports.p0Kar', { p0: periodLabel }) }}</span>
          <div class="jp-stat-value tabular">{{ tl(currentPeriodKar) }}</div>
          <div v-if="kpiTrends.kar !== undefined" class="kpi-trend" :class="trendClass(kpiTrends.kar)" :title="$t('reports.trendVsPrevMonth')">
            <v-icon size="12">{{ trendIcon(kpiTrends.kar) }}</v-icon>
            <span v-if="kpiTrends.kar !== null" class="tabular">{{ $n(Math.abs(kpiTrends.kar)) }}%</span><span v-else>{{ $t('reports.trendNoBaseline') }}</span>
          </div>
        </div>
      </div>

      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-primary);">
          <v-icon size="18">mdi-cart-arrow-right</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('reports.toplamSatisAdedi') }}</span>
          <div class="jp-stat-value tabular">{{ $t('reports.p0Adet', { p0: currentPeriodAdet }) }}</div>
          <div v-if="kpiTrends.adet !== undefined" class="kpi-trend" :class="trendClass(kpiTrends.adet)" :title="$t('reports.trendVsPrevMonth')">
            <v-icon size="12">{{ trendIcon(kpiTrends.adet) }}</v-icon>
            <span v-if="kpiTrends.adet !== null" class="tabular">{{ $n(Math.abs(kpiTrends.adet)) }}%</span><span v-else>{{ $t('reports.trendNoBaseline') }}</span>
          </div>
        </div>
      </div>

      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-accent);">
          <v-icon size="18">mdi-account-group</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('reports.kayitliMusteri') }}</span>
          <div class="jp-stat-value tabular">{{ $t('reports.p0Kisi', { p0: customers.length }) }}</div>
        </div>
      </div>
    </div>

    <!-- Analytics Cockpit: Chart (48%) + Detailed Breakdown (52%) -->
    <div class="reports-split-grid">
      <!-- Left: sales trend chart (Chart.js, the app's single chart library) -->
      <div class="chart-panel-card jp-card">
        <div class="panel-header">
          <div class="panel-title-wrap">
            <v-icon size="16" color="primary" class="mr-1">mdi-finance</v-icon>
            <span class="panel-title">{{ $t('reports.p0SatisTrendiGrafigi', { p0: periodLabel }) }}</span>
          </div>
          <span class="text-caption text-disabled tabular">
            {{ $t('reports.p0IslemKaydi', { p0: activeOrders.length }) }}
          </span>
        </div>

        <div class="chart-container">
          <Bar
            v-if="chartData.datasets[0].data.length"
            :data="chartData"
            :options="chartOptions"
          />
          <div v-else class="empty-chart-state">
            <v-icon size="36" class="mb-2 jp-empty-icon">mdi-chart-bar</v-icon>
            <div class="text-caption text-disabled">{{ $t('reports.buDonemIcinGrafikVerisi') }}</div>
          </div>
        </div>
      </div>

      <!-- Right: Tabbed Breakdown Tables Card -->
      <div class="tables-panel-card jp-card">
        <!-- Tab Navigation Header -->
        <div class="tables-tab-header">
          <div class="tab-buttons">
            <button
              type="button"
              class="tab-btn"
              :class="{ active: activeTab === 'orders' }"
              @click="activeTab = 'orders'"
            >
              <v-icon size="13" class="mr-1">mdi-receipt-text</v-icon>
              {{ $t('reports.islemKayitlariP0', { p0: activeOrders.length }) }}
            </button>
            <button
              type="button"
              class="tab-btn"
              :class="{ active: activeTab === 'tops' }"
              @click="activeTab = 'tops'"
            >
              <v-icon size="13" class="mr-1">mdi-star-outline</v-icon>
              {{ $t('reports.enCokSatanlar') }}
            </button>
            <button
              type="button"
              class="tab-btn"
              :class="{ active: activeTab === 'low' }"
              @click="activeTab = 'low'"
            >
              <v-icon size="13" class="mr-1">mdi-alert-circle-outline</v-icon>
              {{ $t('reports.kritikStokP0', { p0: lowStock.length }) }}
            </button>
            <button
              type="button"
              class="tab-btn"
              :class="{ active: activeTab === 'closing' }"
              @click="openClosingTab"
            >
              <v-icon size="13" class="mr-1">mdi-lock-clock</v-icon>
              {{ $t('reports.gunlukKapanisZRaporu') }}
            </button>
          </div>
        </div>

        <!-- Table View: Active Orders -->
        <div v-if="activeTab === 'orders'" class="table-scroll-area">
          <table class="jp-enterprise-table fit-table">
            <thead>
              <tr>
                <th style="width: 70px;">{{ $t('common.number') }}</th>
                <th style="width: 110px;">{{ $t('reports.tarih') }}</th>
                <th>{{ $t('reports.urunAdi') }}</th>
                <th class="text-right" style="width: 70px;">{{ $t('common.quantity') }}</th>
                <th class="text-right" style="width: 120px;">{{ $t('common.amount') }}</th>
                <th class="text-right" style="width: 120px;">{{ $t('reports.kar') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in activeOrders" :key="item._id">
                <td class="tabular text-disabled text-caption font-weight-bold">#{{ item._id }}</td>
                <td class="tabular text-disabled text-caption">{{ formatDate(item.date) }}</td>
                <td class="font-weight-medium cell-ellipsis" :title="item.productName || ''">{{ item.productName || '—' }}</td>
                <td class="text-right tabular">{{ item.quantity }}</td>
                <td class="text-right tabular font-weight-bold text-success">{{ tl(item.netTotal ?? item.totalPrice) }}</td>
                <td class="text-right tabular" :class="item.kar >= 0 ? 'text-success' : 'text-danger'">
                  {{ item.kar !== null ? tl(item.kar) : '—' }}
                </td>
              </tr>
              <tr v-if="!activeOrders.length">
                <td colspan="6" class="empty-state-cell">
                  {{ $t('reports.seciliDonemIcinIslemKaydi') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Table View: Top Sellers -->
        <div v-else-if="activeTab === 'tops'" class="table-scroll-area">
          <table class="jp-enterprise-table">
            <thead>
              <tr>
                <th>{{ $t('reports.urunAdi') }}</th>
                <th class="text-right" style="width: 80px;">{{ $t('reports.toplamAdet') }}</th>
                <th class="text-right" style="width: 140px;">{{ $t('reports.toplamCiro') }}</th>
                <th class="text-right" style="width: 140px;">{{ $t('reports.toplamKar') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="top in topSellersMonth" :key="top.urun">
                <td class="font-weight-medium text-white">{{ top.urun }}</td>
                <td class="text-right tabular font-weight-bold">{{ $t('reports.p0Adet2', { p0: top.adet }) }}</td>
                <td class="text-right tabular font-weight-bold text-success">{{ tl(top.ciro) }}</td>
                <td class="text-right tabular" :class="top.kar >= 0 ? 'text-success' : 'text-danger'">
                  {{ top.kar !== null ? tl(top.kar) : '—' }}
                </td>
              </tr>
              <tr v-if="!topSellersMonth.length">
                <td colspan="4" class="empty-state-cell">
                  {{ $t('reports.buAyEnCokSatan') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Table View: Low Stock -->
        <div v-else class="table-scroll-area">
          <table class="jp-enterprise-table">
            <thead>
              <tr>
                <th>{{ $t('reports.urunModeli') }}</th>
                <th class="text-right" style="width: 120px;">{{ $t('reports.mevcutStok') }}</th>
                <th class="text-center" style="width: 100px;">{{ $t('common.status') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="low in lowStock" :key="low.isim">
                <td class="font-weight-medium text-white">{{ low.isim }}</td>
                <td class="text-right tabular font-weight-bold" :class="low.stok <= 0 ? 'text-danger' : 'text-warning'">
                  {{ $t('reports.p0Adet2', { p0: low.stok }) }}
                </td>
                <td class="text-center">
                  <span class="jp-badge" :class="low.stok <= 0 ? 'jp-badge-danger' : 'jp-badge-warning'">
                    {{ low.stok <= 0 ? $t('reports.tukendi') : $t('reports.kritik') }}
                  </span>
                </td>
              </tr>
              <tr v-if="!lowStock.length">
                <td colspan="3" class="empty-state-cell">
                  {{ $t('reports.kritikSeviyedeUrunBulunmuyor') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Table View: Daily Closing & Cash Reconciliation -->
        <div v-if="activeTab === 'closing'" class="table-scroll-area pa-3">
          <div class="d-flex justify-space-between align-center mb-3">
            <div>
              <h3 class="font-weight-bold text-white">{{ $t('reports.gunlukKasaAltinKapanisi') }}</h3>
              <small class="text-disabled">{{ $t('reports.tarihP0', { p0: dailySummary.date || $t('reports.bugun') }) }}</small>
            </div>
            <span
              class="jp-badge"
              :class="dailySummary.closing?.isClosed ? 'jp-badge-success' : 'jp-badge-warning'"
            >
              {{ dailySummary.closing?.isClosed ? $t('reports.gunlukKapanisYapildiKilitli') : $t('reports.gunSonuKapanisiBekleniyor') }}
            </span>
          </div>

          <!-- Summary Metric Grid -->
          <div class="closing-summary-grid mb-3">
            <div class="pa-2 rounded" style="background: var(--jp-surface-muted);">
              <small class="text-disabled">{{ $t('reports.gunIciSatisCirosu') }}</small>
              <div class="tabular font-weight-bold text-success">{{ tl(dailySummary.totalSalesTry || 0) }}</div>
              <small class="text-disabled">{{ $t('reports.p0AdetSatis', { p0: dailySummary.salesCount || 0 }) }}</small>
            </div>
            <div class="pa-2 rounded" style="background: var(--jp-surface-muted);">
              <small class="text-disabled">{{ $t('reports.nakitKasaSatisi') }}</small>
              <div class="tabular font-weight-bold text-white">{{ tl(dailySummary.cashSalesTry || 0) }}</div>
              <small class="text-disabled">POS: {{ tl(dailySummary.posSalesTry || 0) }}</small>
            </div>
            <div class="pa-2 rounded" style="background: var(--jp-surface-muted);">
              <small class="text-disabled">{{ $t('reports.tahsilatlar') }}</small>
              <div class="tabular font-weight-bold text-success">+{{ tl(dailySummary.collectionsTry || 0) }}</div>
              <small class="text-disabled">{{ $t('reports.musteriOdemeleri') }}</small>
            </div>
            <div class="pa-2 rounded" style="background: var(--jp-surface-muted);">
              <small class="text-disabled">{{ $t('reports.odemelerGiderler') }}</small>
              <div class="tabular font-weight-bold text-danger">-{{ tl(dailySummary.paymentsTry || 0) }}</div>
              <small class="text-disabled">{{ $t('reports.kasaCikislari') }}</small>
            </div>
          </div>

          <!-- Kasa Mutabakat Formu -->
          <div class="pa-3 rounded mb-3" style="background: var(--jp-surface-card); border: 1px solid var(--jp-border);">
            <div class="d-flex justify-space-between align-center mb-2">
              <span class="font-weight-bold text-white">{{ $t('reports.sistemHesaplananKasaNakitTutari') }}</span>
              <strong class="tabular font-weight-bold text-warning text-h6">{{ tl(dailySummary.calculatedCash || 0) }}</strong>
            </div>
            <div class="text-caption text-disabled">
              {{ $t('reports.devredenKasaP0BugunkuNakit', { p0: tl(dailySummary.openingCashTry || 0), p1: tl(dailySummary.cashInTry || 0), p2: tl(dailySummary.cashOutTry || 0), p3: dailySummary.branch || '—' }) }}
            </div>

            <div class="d-flex gap-3 align-center mt-3">
              <div class="flex-1">
                <label class="form-label">{{ $t('reports.fiiliSayilanKasaNakit') }}</label>
                <input
                  v-model.number="closingForm.closingCashActual"
                  type="number"
                  step="0.01"
                  :disabled="dayClosed"
                  class="settings-input-full tabular"
                  :placeholder="$t('reports.kasadaSayilanGercekTutar')"
                />
              </div>
              <div class="flex-1">
                <label class="form-label">{{ $t('reports.fiiliSayilanHasAltinGram') }}</label>
                <input
                  v-model.number="closingForm.closingGoldActual"
                  type="number"
                  step="0.001"
                  :disabled="dayClosed"
                  class="settings-input-full tabular"
                  :placeholder="$t('reports.kasadaSayilanAltinGrami')"
                />
              </div>
            </div>

            <div class="d-flex justify-space-between align-center mt-3 pt-2" style="border-top: 1px solid var(--jp-border);">
              <span class="text-caption text-disabled">{{ $t('reports.hesaplananKasaFarki') }}</span>
              <strong
                class="tabular font-weight-bold"
                :class="cashDifference >= 0 ? 'text-success' : 'text-danger'"
              >
                {{ cashDifference >= 0 ? '+' : '' }}{{ tl(cashDifference) }}
                {{ cashDifference === 0 ? $t('reports.kasaTamMutabik') : (cashDifference > 0 ? $t('reports.kasaFazlasi') : $t('reports.kasaEksigi')) }}
              </strong>
            </div>

            <div class="d-flex justify-space-between align-center mt-1">
              <span class="text-caption text-disabled">{{ $t('reports.hesaplananHasAltinFarki') }}</span>
              <strong v-if="goldCounted" class="tabular font-weight-bold" :class="goldDifference >= 0 ? 'text-success' : 'text-danger'">
                {{ $t('reports.p0P1GrP2', { p0: goldDifference > 0 ? '+' : '', p1: $weight(goldDifference, 3), p2: goldDifference === 0 ? $t('reports.altinKasasiMutabik') : (goldDifference > 0 ? $t('reports.altinFazlasi') : $t('reports.altinEksigi')) }) }}
              </strong>
              <span v-else class="text-caption text-disabled">{{ $t('reports.altinSayilmadiFarkIslenmezAltin') }}</span>
            </div>
            <div class="text-caption text-disabled mt-1">
              {{ $t('reports.kapanistaNakitVeSayildiysaAltin') }}
            </div>

            <div class="mt-3">
              <label class="form-label">{{ $t('reports.kapanisMutabakatNotu') }}</label>
              <input
                v-model.trim="closingForm.notes"
                type="text"
                :placeholder="$t('reports.ornAksamKasaSayimiEksiksiz')"
                class="settings-input-full"
              />
            </div>

            <div class="d-flex justify-end mt-3">
              <span v-if="!$can('cash:closing')" class="text-caption text-disabled align-self-center mr-2">
                {{ $t('reports.gunSonuKapanisiIcinCash') }}
              </span>
              <span v-if="dayClosed" class="text-caption text-disabled align-self-center mr-2">
                {{ $t('reports.bugununKasasiKilitliBuSubede') }}
              </span>
              <v-btn
                v-if="$can('cash:closing')"
                size="small"
                class="jp-primary"
                :loading="savingClosing"
                :disabled="dayClosed"
                @click="submitDailyClosing"
              >
                <v-icon start size="14">mdi-lock-check</v-icon>
                {{ $t('reports.gunlukKapanisiOnaylaVeKilitle') }}
              </v-btn>
            </div>
          </div>
        </div>

        <!-- Summary Strip at bottom of table -->
        <div class="table-summary-strip">
          <span>{{ $t('common.total') }} <strong>{{ $t('reports.p0Satis', { p0: activeOrders.length }) }}</strong></span>
          <span class="divider">•</span>
          <span>{{ $t('reports.donemCirosu') }} <strong class="tabular text-success">{{ tl(currentPeriodCiro) }}</strong></span>
          <span class="divider">•</span>
          <span>{{ $t('reports.tahminiKar') }} <strong class="tabular text-success">{{ tl(currentPeriodKar) }}</strong></span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { dateTime, money, t } from '@/i18n';
import { themeState } from '@/theme';
import { Bar } from "vue-chartjs";
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip } from "chart.js";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);
import apiService from "@/services/api";
import { periodTrend } from "@/services/periodFilters";
import { lowStockReportPath } from "@/services/stockLevels";

export default {
  name: "ReportPage",
  components: { Bar },
  data() {
    return {
      selectedPeriod: "monthly",
      activeTab: "orders",
      dayOrders: [],
      weekOrders: [],
      monthOrders: [],
      prevMonthOrders: [],
      topSellersMonth: [],
      lowStock: [],
      customers: [],
      loading: false,
      error: "",
      dailySummary: {
        date: '',
        salesCount: 0,
        totalSalesTry: 0,
        cashSalesTry: 0,
        posSalesTry: 0,
        transferSalesTry: 0,
        collectionsTry: 0,
        paymentsTry: 0,
        calculatedCash: 0,
        calculatedGold: 0,
        closing: null,
      },
      closingForm: {
        closingCashActual: 0,
        closingGoldActual: 0,
        notes: '',
      },
      savingClosing: false,
    };
  },
  computed: {
    activeOrders() {
      if (this.selectedPeriod === "daily") return this.dayOrders;
      if (this.selectedPeriod === "weekly") return this.weekOrders;
      return this.monthOrders;
    },
    periodLabel() {
      if (this.selectedPeriod === "daily") return t('reports.periodDaily');
      if (this.selectedPeriod === "weekly") return t('reports.periodWeekly');
      return t('reports.periodMonthly');
    },
    currentPeriodCiro() {
      return this.sumTotal(this.activeOrders);
    },
    currentPeriodKar() {
      return this.sumKar(this.activeOrders);
    },
    currentPeriodAdet() {
      return this.activeOrders.reduce((sum, o) => sum + (o.quantity || 0), 0);
    },
    /**
     * Month-over-month change for the KPI ribbon. Only the monthly view has a
     * comparable baseline (`/api/reports/monthly?prev=1`); other periods hide
     * the indicator (undefined). A zero baseline yields null ("new period"),
     * never a fabricated +100%.
     */
    kpiTrends() {
      if (this.selectedPeriod !== 'monthly') return {};
      const prev = this.prevMonthOrders || [];
      const kar = this.currentPeriodKar;
      const prevKar = this.sumKar(prev);
      return {
        ciro: periodTrend(this.currentPeriodCiro, this.sumTotal(prev)),
        // Unknown cost → unknown profit: hide rather than mislabel as a new period.
        kar: kar === null || prevKar === null ? undefined : periodTrend(kar, prevKar),
        adet: periodTrend(this.currentPeriodAdet, prev.reduce((sum, o) => sum + (o.quantity || 0), 0)),
      };
    },
    cashDifference() {
      // Display only (the server computes the posted difference exactly).
      const actual = Math.round((Number(this.closingForm.closingCashActual) || 0) * 100);
      const calc = Math.round((Number(this.dailySummary.calculatedCash) || 0) * 100);
      return (actual - calc) / 100;
    },
    goldCounted() {
      const v = this.closingForm.closingGoldActual;
      return v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
    },
    goldDifference() {
      // Display only (milligram exact); the server posts the difference to gold_over_short.
      if (!this.goldCounted) return 0;
      const actual = Math.round(Number(this.closingForm.closingGoldActual) * 1000);
      const calc = Math.round((Number(this.dailySummary.calculatedGold) || 0) * 1000);
      return (actual - calc) / 1000;
    },
    dayClosed() {
      return Boolean(this.dailySummary.closing?.isClosed);
    },
    chartLabels() {
      return this.activeOrders.slice(0, 8).map((o) => {
        const prod = o.productName || t('reports.chartSale');
        return prod.length > 12 ? prod.substring(0, 12) + "…" : prod;
      });
    },
    chartData() {
      const data = this.activeOrders.slice(0, 8).map((o) => Number(o.netTotal ?? o.totalPrice ?? 0) || 0);
      return {
        labels: this.chartLabels,
        datasets: [{
          label: t('reports.chartSeries'),
          data,
          backgroundColor: themeState.chart[0] || '#c9a227',
          borderRadius: 4,
          maxBarThickness: 48,
        }],
      };
    },
    chartOptions() {
      // Colours come from the active palette; animation follows reduced motion.
      const isDark = themeState.mode === 'dark';
      const base = themeState.tokens?.base;
      const axis = base ? base.textMuted : (isDark ? '#a6a49f' : '#5d5950');
      const line = base ? base.border : (isDark ? '#2a2c32' : '#e1ddd4');
      const formatAmount = (val) => money(Number(val) || 0, 'TRY', { maximumFractionDigits: 0, minimumFractionDigits: 0 });

      return {
        responsive: true,
        maintainAspectRatio: false,
        animation: themeState.reducedMotion ? false : { duration: 280 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => money(Number(ctx.parsed.y) || 0) } },
        },
        scales: {
          x: { ticks: { color: axis, font: { size: 10 } }, grid: { display: false }, border: { color: line } },
          y: {
            ticks: { color: axis, font: { size: 10 }, callback: formatAmount },
            grid: { color: line },
            border: { dash: [3, 3], color: line },
          },
        },
      };
    },
  },
  mounted() {
    this.loadReports();
  },
  methods: {
    tl(n) {
      if (n === null || n === undefined) return "—";
      return money(Number(n) || 0);
    },
    trendClass(value) {
      if (value === null) return 'trend-neutral';
      return value >= 0 ? 'trend-up' : 'trend-down';
    },
    trendIcon(value) {
      if (value === null) return 'mdi-minus';
      return value >= 0 ? 'mdi-arrow-up-bold' : 'mdi-arrow-down-bold';
    },
    sumTotal(list) {
      return (list || []).reduce((t, o) => t + (o.netTotal ?? o.totalPrice ?? 0), 0);
    },
    sumKar(list) {
      if (!list || !list.length) return 0;
      if (list.some((o) => o.kar === null || o.kar === undefined)) return null;
      return list.reduce((t, o) => t + o.kar, 0);
    },
    formatDate(dateStr) {
      return dateTime(dateStr);
    },
    async loadReports() {
      this.loading = true;
      this.error = "";
      try {
        const [day, week, month, prevMonth, tops, low, cust] = await Promise.all([
          apiService.get("/api/reports/daily"),
          apiService.get("/api/reports/weekly"),
          apiService.get("/api/reports/monthly"),
          apiService.get("/api/reports/monthly?prev=1"),
          apiService.get("/api/reports/top-sellers"),
          apiService.get(lowStockReportPath(this.$store.state.settings.lowStockThreshold)),
          apiService.get("/api/customers"),
        ]);
        this.dayOrders = day || [];
        this.weekOrders = week || [];
        this.monthOrders = month || [];
        this.prevMonthOrders = prevMonth || [];
        this.topSellersMonth = tops || [];
        this.lowStock = low || [];
        this.customers = cust || [];
      } catch (err) {
        this.error = err.message || t('reports.loadFailed');
      } finally {
        this.loading = false;
      }
    },
    async openClosingTab() {
      this.activeTab = 'closing';
      await this.fetchDailySummary();
    },
    async fetchDailySummary() {
      try {
        const data = await apiService.get('/api/cash/daily-summary');
        this.dailySummary = data || {};
        if (data?.closing?.isClosed) {
          this.closingForm.closingCashActual = data.closing.closingCashActual;
          this.closingForm.closingGoldActual = data.closing.closingGoldActual;
          this.closingForm.notes = data.closing.notes;
        } else {
          this.closingForm.closingCashActual = data.calculatedCash || 0;
          this.closingForm.closingGoldActual = data.calculatedGold || 0;
        }
      } catch (err) {
        console.warn('Daily summary fetch warning:', err);
      }
    },
    async submitDailyClosing() {
      this.savingClosing = true;
      try {
        const saved = await apiService.post('/api/cash/daily-closing', {
          // Exact decimal text (shortest round-trip form of the typed number).
          closingCashActual: String(this.closingForm.closingCashActual ?? ''),
          // An empty gold field means "gold not counted": omit it so no
          // gold difference is posted (sending 0 would write off the till).
          ...(this.goldCounted ? { closingGoldActual: String(this.closingForm.closingGoldActual) } : {}),
          notes: this.closingForm.notes,
        });
        this.dailySummary.closing = saved;
        await this.fetchDailySummary();
        this.$store.dispatch('notifications/showSuccess', t('reports.gunlukKapanisVeZRaporu'));
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('reports.kapanisKaydedilemediP0', { p0: err.message }));
      } finally {
        this.savingClosing = false;
      }
    },
  },
};
</script>

<style scoped>
.reports-page-shell {
  height: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  gap: 8px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Period Toggle Button Group */
.period-toggle-group {
  display: flex;
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  padding: 2px;
}

.period-btn {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--jp-text-muted);
  border: 0;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color var(--jp-motion-fast) var(--jp-ease-standard), border-color var(--jp-motion-fast) var(--jp-ease-standard), color var(--jp-motion-fast) var(--jp-ease-standard), box-shadow var(--jp-motion-fast) var(--jp-ease-standard), opacity var(--jp-motion-fast) var(--jp-ease-standard);
}
.period-btn:hover {
  color: var(--jp-text-emphasis);
}
.period-btn.active {
  background: var(--jp-gold);
  color: var(--jp-on-primary);
  font-weight: 700;
}

/* KPI Ribbon */
.reports-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  flex-shrink: 0;
}

.kpi-trend {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-top: 2px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
}
.kpi-trend .v-icon { color: inherit; }
.trend-up { color: var(--jp-success); }
.trend-down { color: var(--jp-danger); }
.trend-neutral { color: var(--jp-text-subtle); }

.closing-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

/* Analytics Split Grid */
.reports-split-grid {
  display: grid;
  /* fr, not %: percentages plus the gap overflowed and clipped the amounts. */
  grid-template-columns: minmax(0, 46fr) minmax(0, 54fr);
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Chart Panel */
.chart-panel-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 8px 12px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--jp-border);
  flex-shrink: 0;
}

.panel-title-wrap {
  display: flex;
  align-items: center;
}

.panel-title {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: var(--jp-text-emphasis);
}

.chart-container {
  flex: 1;
  min-height: 0;
  position: relative;
  margin-top: 6px;
}

.empty-chart-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}

/* Tables Panel */
.tables-panel-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 8px 12px;
}

.tables-tab-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--jp-border);
  flex-shrink: 0;
}

.tab-buttons {
  display: flex;
  gap: 6px;
}

.tab-btn {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--jp-text-muted);
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--jp-radius-sm);
  cursor: pointer;
  transition: background-color var(--jp-motion-fast) var(--jp-ease-standard), border-color var(--jp-motion-fast) var(--jp-ease-standard), color var(--jp-motion-fast) var(--jp-ease-standard), box-shadow var(--jp-motion-fast) var(--jp-ease-standard), opacity var(--jp-motion-fast) var(--jp-ease-standard);
}
.tab-btn:hover {
  background: var(--jp-border-soft);
  color: var(--jp-text-emphasis);
}
.tab-btn.active {
  background: var(--jp-surface-muted);
  border-color: var(--jp-border);
  color: var(--jp-gold);
}

.fit-table {
  width: 100%;
}
.fit-table th,
.fit-table td {
  white-space: nowrap;
}
/* The name column takes the remaining width and truncates; the other
   columns size to their content, so amounts are never cut off. */
.cell-ellipsis {
  max-width: 0;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table-scroll-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: auto;
}

.jp-enterprise-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.jp-enterprise-table thead th {
  position: sticky;
  top: 0;
  background: var(--jp-surface-muted);
  color: var(--jp-text-subtle);
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--jp-border);
  z-index: 2;
  white-space: nowrap;
}

.jp-enterprise-table tbody td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--jp-border-soft);
  color: var(--jp-text);
  white-space: nowrap;
}

.jp-enterprise-table tbody tr:hover {
  background: var(--jp-surface-card-hover);
}

.empty-state-cell {
  text-align: center;
  padding: 30px 12px;
  color: var(--jp-text-muted);
}

.table-summary-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--jp-border);
  font-size: 11px;
  color: var(--jp-text-muted);
  flex-shrink: 0;
}
.table-summary-strip .divider {
  color: var(--jp-border-light);
}

@media (max-width: 950px) {
  .reports-split-grid {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .reports-kpi-row {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
