<template>
  <div class="jp-page-shell dashboard-shell">
    <!-- Top Bar / Header -->
    <div class="jp-page-header">
      <div class="page-heading-left">
        <div>
          <div class="jp-section-label">{{ $t('dashboard.eyebrow') }}</div>
          <h1 class="page-title">
            <v-icon size="20" color="primary">mdi-view-dashboard</v-icon>
            {{ $t('dashboard.title') }}
          </h1>
        </div>
      </div>
      <div class="header-actions">
        <span class="refresh-meta d-none d-sm-inline">
          <v-icon size="12" class="mr-1">mdi-clock-outline</v-icon>
          {{ $t('common.lastUpdated', { time: lastUpdated ? $time(lastUpdated, true) : '—' }) }}
        </span>
        <v-btn
          size="small"
          class="jp-secondary"
          :loading="loading"
          @click="refreshDashboard"
        >
          <v-icon start size="14">mdi-refresh</v-icon>
          {{ $t('common.refresh') }}
        </v-btn>
        <v-btn
          size="small"
          class="jp-primary"
          @click="goToPage('/sales?newSale=1')"
        >
          <v-icon start size="14">mdi-plus</v-icon>
          {{ $t('dashboard.quickSale') }}
        </v-btn>
      </div>
    </div>

    <!-- Error Alert if any -->
    <v-alert
      v-if="error"
      density="compact"
      type="warning"
      variant="tonal"
      class="mb-2 py-1 text-caption"
      closable
      @click:close="error = ''"
    >
      {{ error }}
    </v-alert>

    <!-- 4 KPI Stat Cards Strip -->
    <div class="kpi-grid">
      <div v-for="metric in summaryMetrics" :key="metric.key" class="jp-stat-card" :title="metric.hint">
        <div class="jp-stat-icon-wrap" :class="`tone-${metric.tone}`">
          <v-icon size="18">{{ metric.icon }}</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ metric.label }}</span>
          <div class="jp-stat-value" :class="{ 'tabular': true }">
            {{ metric.value }}
          </div>
        </div>
      </div>
    </div>

    <!-- Live market ticker (follows Settings → Market → auto-refresh) -->
    <MarketTicker ref="ticker" />

    <!-- Main Cockpit: 2 Column Layout (Zero-Scroll Fitting) -->
    <div class="cockpit-grid">
      <!-- Left Column: Quick Actions + Stock Health -->
      <div class="cockpit-col-left">
        <!-- Quick Actions Card -->
        <div class="action-panel jp-card">
          <div class="panel-header">
            <span class="panel-title">
              <v-icon size="14" color="primary" class="mr-1">mdi-lightning-bolt</v-icon>
              {{ $t('dashboard.quickActions') }}
            </span>
          </div>
          <div class="action-buttons-grid">
            <button
              v-for="act in quickActions"
              :key="act.path"
              type="button"
              class="quick-action-btn"
              @click="goToPage(act.path)"
            >
              <div class="act-icon-wrap" :class="`tone-${act.tone}`">
                <v-icon size="18">{{ act.icon }}</v-icon>
              </div>
              <div class="act-text">
                <strong>{{ $t(act.titleKey) }}</strong>
                <small>{{ $t(act.subtitleKey) }}</small>
              </div>
              <v-icon size="14" class="act-arrow flip-rtl">mdi-arrow-right</v-icon>
            </button>
          </div>
        </div>

        <!-- Low Stock Alerts / Watchlist Card -->
        <div class="watchlist-panel jp-card">
          <div class="panel-header">
            <span class="panel-title">
              <v-icon size="14" color="warning" class="mr-1">mdi-alert-circle-outline</v-icon>
              {{ $t('dashboard.lowStock') }}
            </span>
            <v-btn
              variant="text"
              size="x-small"
              class="px-1 text-caption text-disabled"
              @click="goToPage('/products')"
            >
              {{ $t('dashboard.stockLink') }} <v-icon size="10" class="flip-rtl">mdi-chevron-right</v-icon>
            </v-btn>
          </div>
          <div class="watchlist-list">
            <div
              v-for="item in lowStockItems"
              :key="item.isim"
              class="watchlist-item"
            >
              <div class="watchlist-info">
                <span class="item-name">{{ item.isim }}</span>
                <span class="item-sub">{{ $t('dashboard.lowStockHint') }}</span>
              </div>
              <span class="jp-badge jp-badge-danger">
                {{ $t('dashboard.remaining', { count: $n(item.stok) }) }}
              </span>
            </div>
            <div v-if="!lowStockItems.length" class="empty-hint">
              <v-icon size="16" color="success" class="mr-1">mdi-check-circle-outline</v-icon>
              {{ $t('dashboard.noLowStock') }}
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column: Recent Transactions Table -->
      <div class="cockpit-col-right jp-card">
        <div class="panel-header">
          <span class="panel-title">
            <v-icon size="14" color="info" class="mr-1">mdi-history</v-icon>
            {{ $t('dashboard.recentSales') }}
          </span>
          <v-btn
            variant="text"
            size="x-small"
            class="text-caption"
            @click="goToPage('/sales')"
          >
            {{ $t('dashboard.allSales') }} <v-icon size="12" class="flip-rtl">mdi-chevron-right</v-icon>
          </v-btn>
        </div>
        <div class="table-container">
          <table class="recent-sales-table">
            <thead>
              <tr>
                <th>{{ $t('common.customer') }}</th>
                <th>{{ $t('common.product') }}</th>
                <th class="text-right">{{ $t('common.quantity') }}</th>
                <th class="text-right">{{ $t('common.amount') }}</th>
                <th>{{ $t('dashboard.colPayment') }}</th>
                <th class="text-right">{{ $t('common.date') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="sale in recentSales" :key="sale._id">
                <td class="font-weight-medium text-white">{{ sale.customerName || $t('common.unknown') }}</td>
                <td>{{ sale.productName || '—' }}</td>
                <td class="text-right tabular">{{ $n(sale.quantity) }}</td>
                <td class="text-right tabular font-weight-bold text-success">{{ money(sale.totalPrice) }}</td>
                <td>
                  <span class="jp-badge" :class="paymentBadgeClass(sale.paymentMethod)">
                    {{ $payment(sale.paymentMethod) }}
                  </span>
                </td>
                <td class="text-right text-disabled tabular text-caption">
                  {{ $dateTime(sale.date) }}
                </td>
              </tr>
              <tr v-if="!recentSales.length">
                <td colspan="6" class="text-center text-disabled py-4">
                  {{ $t('dashboard.noSales') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import apiService from '@/services/api';
import { lowStockReportPath } from '@/services/stockLevels';
import { money, n, t } from '@/i18n';
import MarketTicker from '@/components/dashboard/MarketTicker.vue';

export default {
  name: 'DashboardPage',
  components: { MarketTicker },
  data() {
    return {
      summary: null,
      recentSales: [],
      lowStockItems: [],
      error: '',
      lastUpdated: null,
      loading: false,
      quickActions: [
        { titleKey: 'dashboard.actions.sale', subtitleKey: 'dashboard.actions.saleSub', icon: 'mdi-lightning-bolt', tone: 'primary', path: '/sales?newSale=1' },
        { titleKey: 'dashboard.actions.products', subtitleKey: 'dashboard.actions.productsSub', icon: 'mdi-cube-outline', tone: 'info', path: '/products' },
        { titleKey: 'dashboard.actions.customers', subtitleKey: 'dashboard.actions.customersSub', icon: 'mdi-account-group-outline', tone: 'success', path: '/customers' },
        { titleKey: 'dashboard.actions.calculator', subtitleKey: 'dashboard.actions.calculatorSub', icon: 'mdi-calculator-variant-outline', tone: 'accent', path: '/calculator' },
      ],
    };
  },
  computed: {
    summaryMetrics() {
      return [
        {
          key: 'revenue',
          label: this.$t('dashboard.kpi.revenue'),
          value: this.summary ? this.money(this.summary.totalRevenue) : '—',
          icon: 'mdi-wallet-outline',
          tone: 'info',
        },
        {
          key: 'profit',
          label: this.$t('dashboard.kpi.profit'),
          value: this.summary && this.summary.profitDataComplete ? this.money(this.summary.totalProfit) : '—',
          hint: this.summary && !this.summary.profitDataComplete ? this.$t('dashboard.kpi.profitIncomplete') : undefined,
          icon: 'mdi-chart-areaspline',
          tone: 'success',
        },
        {
          key: 'quantity',
          label: this.$t('dashboard.kpi.quantity'),
          value: this.summary ? this.number(this.summary.totalQuantity) : '—',
          icon: 'mdi-package-variant-closed',
          tone: 'accent',
        },
        {
          key: 'customers',
          label: this.$t('dashboard.kpi.customers'),
          value: this.summary ? this.number(this.summary.totalCustomers) : '—',
          icon: 'mdi-account-check-outline',
          tone: 'primary',
        },
      ];
    },
  },
  watch: {
    '$store.state.settings.lowStockThreshold'() {
      this.loadLowStock();
    },
  },
  mounted() {
    this.refreshDashboard();
  },
  methods: {
    goToPage(path) {
      this.$router.push(path);
    },
    async refreshDashboard() {
      this.loading = true;
      this.error = '';
      try {
        await Promise.allSettled([
          this.loadSummary(),
          this.$refs.ticker?.load(),
          this.loadRecentSales(),
          this.loadLowStock(),
        ]);
        this.lastUpdated = new Date();
      } finally {
        this.loading = false;
      }
    },
    async loadSummary() {
      try {
        this.summary = await apiService.get('/api/dashboard/summary');
      } catch (err) {
        this.error = err.message || t('dashboard.summaryFailed');
      }
    },
    async loadRecentSales() {
      try {
        const sales = await apiService.get('/api/sales');
        this.recentSales = (sales || []).slice(0, 6);
      } catch (err) {
        this.recentSales = [];
      }
    },
    async loadLowStock() {
      try {
        const items = await apiService.get(lowStockReportPath(this.$store.state.settings.lowStockThreshold));
        this.lowStockItems = (items || []).slice(0, 4);
      } catch (err) {
        this.lowStockItems = [];
      }
    },
    money(value) {
      return money(Number(value) || 0);
    },
    number(value) {
      return n(Number(value) || 0);
    },
    paymentBadgeClass(method) {
      if (method === 'kredi kartı') return 'jp-badge-info';
      if (method === 'havale') return 'jp-badge-warning';
      return 'jp-badge-success';
    },
  },
};
</script>

<style scoped>
.dashboard-shell {
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
  gap: 8px;
}

.refresh-meta {
  font-size: 11px;
  color: var(--jp-text-muted);
  display: flex;
  align-items: center;
}

/* KPI Ribbon */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  flex-shrink: 0;
}

/* Main Cockpit Split */
.cockpit-grid {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.cockpit-col-left {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
}

.cockpit-col-right {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 10px 12px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.panel-title {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  color: var(--jp-text-white);
  display: flex;
  align-items: center;
}

/* Quick Actions Card */
.action-panel {
  padding: 10px 12px;
  flex-shrink: 0;
}

.action-buttons-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.quick-action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  color: var(--jp-text);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--jp-motion-fast) var(--jp-ease-standard), border-color var(--jp-motion-fast) var(--jp-ease-standard), color var(--jp-motion-fast) var(--jp-ease-standard), box-shadow var(--jp-motion-fast) var(--jp-ease-standard), opacity var(--jp-motion-fast) var(--jp-ease-standard);
}
.quick-action-btn:hover {
  background: var(--jp-surface-elevated);
  border-color: var(--jp-border-light);
  transform: translateY(-1px);
}

.act-icon-wrap {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-border-soft);
  flex-shrink: 0;
}

.act-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.act-text strong {
  font-size: 11px;
  color: var(--jp-text-white);
  line-height: 1.2;
}
.act-text small {
  font-size: 9px;
  color: var(--jp-text-muted);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.act-arrow {
  color: var(--jp-text-subtle);
  transition: transform var(--jp-motion-fast) var(--jp-ease-standard);
}
.quick-action-btn:hover .act-arrow {
  color: var(--jp-gold);
  transform: translateX(2px);
}

/* Watchlist / Low Stock */
.watchlist-panel {
  padding: 10px 12px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.watchlist-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.watchlist-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  background: var(--jp-surface-muted);
  border-radius: var(--jp-radius-sm);
  border: 1px solid var(--jp-border);
}

.watchlist-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.item-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--jp-text-white);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-sub {
  font-size: 9px;
  color: var(--jp-text-subtle);
}

.empty-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 11px;
  color: var(--jp-text-muted);
}

/* Recent Sales Table */
.table-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.recent-sales-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.recent-sales-table thead th {
  position: sticky;
  top: 0;
  background: var(--jp-surface-muted);
  color: var(--jp-text-subtle);
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--jp-border);
  z-index: 2;
}

.recent-sales-table tbody td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--jp-border-soft);
  color: var(--jp-text);
  white-space: nowrap;
}

.recent-sales-table tbody tr:hover {
  background: var(--jp-surface-card-hover);
}

@media (max-width: 1024px) {
  .cockpit-grid {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .kpi-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
