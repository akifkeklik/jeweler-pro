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
      <!-- Left: sales trend chart -->
      <SalesTrendChart :orders="activeOrders" :period-label="periodLabel" />

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
              @click="activeTab = 'closing'"
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
        <div v-else-if="activeTab === 'low'" class="table-scroll-area">
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

        <!-- Daily closing & Z report (loads when the tab opens) -->
        <DailyClosingPanel v-else />

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
import SalesTrendChart from '@/components/reports/SalesTrendChart.vue';
import DailyClosingPanel from '@/components/reports/DailyClosingPanel.vue';
import apiService from "@/services/api";
import { periodTrend } from "@/services/periodFilters";
import { lowStockReportPath } from "@/services/stockLevels";

export default {
  name: "ReportPage",
  components: { SalesTrendChart, DailyClosingPanel },
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
