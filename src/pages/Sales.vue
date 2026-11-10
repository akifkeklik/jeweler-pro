<template>
  <div class="jp-page-shell sales-page-shell">
    <!-- Header -->
    <div class="jp-page-header">
      <div class="page-heading-left">
        <div>
          <div class="jp-section-label">{{ $t('sales.eyebrow') }}</div>
          <h1 class="page-title">
            <v-icon size="20" color="primary">mdi-cart</v-icon>
            {{ $t('sales.title') }}
          </h1>
        </div>
      </div>
      <div class="header-actions">
        <v-btn size="small" class="jp-secondary" :loading="loading" @click="loadData">
          <v-icon start size="14">mdi-refresh</v-icon>
          {{ $t('common.refresh') }}
        </v-btn>
        <v-btn v-if="$can('sales:write')" size="small" class="jp-primary" @click="openNewSaleDialog">
          <v-icon start size="14">mdi-lightning-bolt</v-icon>
          {{ $t('sales.newSale') }}
        </v-btn>
      </div>
    </div>

    <!-- KPI Metrics Ribbon (from server-computed sale totals, cancelled sales excluded) -->
    <div class="sales-kpi-row">
      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-info);"><v-icon size="18">mdi-cart-check</v-icon></div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('sales.kpi.active') }}</span>
          <div class="jp-stat-value tabular">{{ $t('sales.kpi.activeValue', { count: $n(activeSales.length) }) }}</div>
        </div>
      </div>
      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-success);"><v-icon size="18">mdi-cash-multiple</v-icon></div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('sales.kpi.revenue') }}</span>
          <div class="jp-stat-value tabular">{{ money(toplamCiro) }}</div>
        </div>
      </div>
      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-warning);"><v-icon size="18">mdi-account-cash-outline</v-icon></div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('sales.kpi.receivable') }}</span>
          <div class="jp-stat-value tabular">{{ money(acikAlacak) }}</div>
        </div>
      </div>
      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-accent);"><v-icon size="18">mdi-account-group-outline</v-icon></div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('sales.kpi.customers') }}</span>
          <div class="jp-stat-value tabular">{{ $t('sales.kpi.customersValue', { count: $n(musteriSayisi) }) }}</div>
        </div>
      </div>
    </div>

    <!-- Main Table Card -->
    <div class="sales-main-card jp-card">
      <div class="sales-toolbar">
        <div class="search-input-wrap">
          <v-icon size="16" class="search-icon">mdi-magnify</v-icon>
          <input v-model.trim="search" type="search" :placeholder="$t('sales.searchPlaceholder')" :aria-label="$t('common.search')" class="sales-search-field" />
        </div>
        <div class="filter-controls">
          <select v-model="selectedPaymentStatus" class="compact-select" :aria-label="$t('common.status')">
            <option value="">{{ $t('sales.allPaymentStatuses') }}</option>
            <option value="paid">{{ $t('status.payment.paid') }}</option>
            <option value="partial">{{ $t('status.payment.partial') }}</option>
            <option value="unpaid">{{ $t('status.payment.unpaid') }}</option>
            <option value="refunded">{{ $t('sales.refundedOrCancelled') }}</option>
          </select>
          <select v-model="selectedCustomer" class="compact-select d-none d-md-inline-block" :aria-label="$t('common.customer')">
            <option value="">{{ $t('sales.allCustomers') }}</option>
            <option v-for="c in customers" :key="c._id" :value="c.name">{{ c.name }}</option>
          </select>
          <div class="date-range-group" role="group">
            <input v-model="dateFrom" type="date" class="compact-select compact-date" :title="$t('common.from')" :aria-label="$t('common.from')" />
            <span class="date-range-sep" aria-hidden="true">–</span>
            <input v-model="dateTo" type="date" class="compact-select compact-date" :title="$t('common.to')" :aria-label="$t('common.to')" />
            <button v-if="dateFrom || dateTo" type="button" class="date-range-clear" :title="$t('common.clear')" :aria-label="$t('common.clear')" @click="dateFrom = ''; dateTo = ''">
              <v-icon size="14">mdi-close</v-icon>
            </button>
          </div>
          <span class="record-counter tabular">{{ $t('common.showing', { count: $n(filteredSales.length) }) }}</span>
        </div>
      </div>

      <div v-if="error" class="sales-error-banner">
        <v-icon size="14" class="mr-1">mdi-alert-circle-outline</v-icon>
        {{ $t('sales.loadFailed', { reason: error }) }}
      </div>

      <div class="table-scroll-wrap">
        <table class="jp-enterprise-table">
          <thead>
            <tr>
              <th style="width: 92px;">{{ $t('sales.col.receipt') }}</th>
              <th>{{ $t('common.customer') }}</th>
              <th>{{ $t('sales.col.products') }}</th>
              <th class="text-right" style="width: 70px;">{{ $t('common.quantity') }}</th>
              <th class="text-right" style="width: 120px;">{{ $t('common.total') }}</th>
              <th class="text-right" style="width: 120px;">{{ $t('sales.col.balance') }}</th>
              <th style="width: 120px;">{{ $t('common.status') }}</th>
              <th class="text-right" style="width: 130px;">{{ $t('common.date') }}</th>
              <th class="text-center" style="width: 150px;">{{ $t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && !salesData.length">
              <td colspan="9" class="empty-table-state">
                <v-progress-circular indeterminate size="22" color="primary"></v-progress-circular>
              </td>
            </tr>
            <tr v-for="sale in filteredSales" :key="sale._id" :class="{ 'row-cancelled': sale.status === 'cancelled' }">
              <td class="tabular text-disabled text-caption font-weight-bold">#{{ sale._id }}</td>
              <td class="font-weight-medium text-white">
                <v-icon size="14" color="primary" class="mr-1">mdi-account</v-icon>
                {{ sale.customerName || $t('sales.noCustomer') }}
              </td>
              <td><span class="product-tag">{{ sale.productName || $t('sales.unspecified') }}</span></td>
              <td class="text-right tabular font-weight-bold">{{ $n(sale.quantity) }}</td>
              <td class="text-right tabular font-weight-bold text-success">{{ money(fin(sale).total) }}</td>
              <td class="text-right tabular" :class="fin(sale).balanceDue > 0 ? 'text-warning font-weight-bold' : 'text-disabled'">
                {{ money(fin(sale).balanceDue) }}
              </td>
              <td>
                <span class="jp-badge" :class="statusBadgeClass(sale)">{{ statusLabel(sale) }}</span>
              </td>
              <td class="text-right tabular text-disabled text-caption">{{ formatDate(sale.date) }}</td>
              <td class="text-center">
                <div class="table-actions">
                  <v-btn icon size="x-small" variant="text" color="info" :title="$t('sales.actionView')" :aria-label="$t('sales.actionView')" @click="openDialog('detail', sale)">
                    <v-icon size="15">mdi-eye-outline</v-icon>
                  </v-btn>
                  <v-btn
                    v-if="$can('sales:write') && canCollect(sale)"
                    icon size="x-small" variant="text" color="success" :title="$t('sales.actionCollect')" :aria-label="$t('sales.actionCollect')"
                    @click="openDialog('payment', sale)"
                  >
                    <v-icon size="15">mdi-cash-plus</v-icon>
                  </v-btn>
                  <v-btn
                    v-if="$can('sales:cancel') && canReturn(sale)"
                    icon size="x-small" variant="text" color="secondary" :title="$t('sales.actionReturn')" :aria-label="$t('sales.actionReturn')"
                    @click="openDialog('return', sale)"
                  >
                    <v-icon size="15">mdi-keyboard-return</v-icon>
                  </v-btn>
                  <v-btn
                    v-if="$can('sales:write') && sale.status !== 'cancelled'"
                    icon size="x-small" variant="text" color="warning" :title="$t('sales.actionEdit')" :aria-label="$t('sales.actionEdit')"
                    @click="openDialog('edit', sale)"
                  >
                    <v-icon size="15">mdi-pencil-outline</v-icon>
                  </v-btn>
                  <v-btn
                    v-if="$can('sales:cancel') && sale.status === 'completed'"
                    icon size="x-small" variant="text" color="error" :title="$t('sales.actionCancel')" :aria-label="$t('sales.actionCancel')"
                    @click="openDialog('cancel', sale)"
                  >
                    <v-icon size="15">mdi-cancel</v-icon>
                  </v-btn>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && !filteredSales.length">
              <td colspan="9" class="empty-table-state">
                <v-icon size="32" class="mb-2 jp-empty-icon">mdi-receipt-text-outline</v-icon>
                <div>{{ $t('sales.noSales') }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <NewSaleDialog
      v-model="dialogs.newSale"
      :customers="customers"
      :products="availableProducts"
      :initial-customer-id="initialCustomerId"
      @saved="loadData"
    />
    <SaleDetailDialog v-model="dialogs.detail" :sale="selectedSale" />
    <SalePaymentDialog v-model="dialogs.payment" :sale="selectedSale" @saved="fetchSales" />
    <SaleReturnDialog v-model="dialogs.return" :sale="selectedSale" @saved="loadData" />
    <SaleEditDialog v-model="dialogs.edit" :sale="selectedSale" @saved="fetchSales" />
    <SaleCancelDialog v-model="dialogs.cancel" :sale="selectedSale" @saved="loadData" />
  </div>
</template>

<script>
import { mapActions, mapState } from 'vuex';
import apiService from '@/services/api';
import { formatTry } from '@/services/finance';
import { dateTime, normalizeSearch } from '@/i18n';
import { isWithinDayRange } from '@/services/periodFilters';
import { canCollect, canReturn, saleFinancial, saleStatusBadge, saleStatusLabel } from '@/services/saleView';
import NewSaleDialog from '@/components/sales/NewSaleDialog.vue';
import SaleDetailDialog from '@/components/sales/SaleDetailDialog.vue';
import SalePaymentDialog from '@/components/sales/SalePaymentDialog.vue';
import SaleReturnDialog from '@/components/sales/SaleReturnDialog.vue';
import SaleEditDialog from '@/components/sales/SaleEditDialog.vue';
import SaleCancelDialog from '@/components/sales/SaleCancelDialog.vue';

/**
 * Sales list: filters, KPIs and row actions. Every action lives in its own
 * dialog component (src/components/sales/*); this page only decides which
 * sale is selected and reloads after a change.
 */
export default {
  name: 'SalesPage',
  components: { NewSaleDialog, SaleDetailDialog, SalePaymentDialog, SaleReturnDialog, SaleEditDialog, SaleCancelDialog },
  data() {
    return {
      search: '',
      selectedPaymentStatus: '',
      selectedCustomer: '',
      dateFrom: '',
      dateTo: '',
      selectedSale: null,
      availableProducts: [],
      dialogs: { newSale: false, detail: false, payment: false, return: false, edit: false, cancel: false },
    };
  },
  computed: {
    ...mapState('sales', { sales: 'items', loading: 'loading', error: 'error' }),
    ...mapState('customers', { customers: 'items' }),
    salesData() {
      return this.sales || [];
    },
    activeSales() {
      return this.salesData.filter((s) => s.status !== 'cancelled');
    },
    toplamCiro() {
      return this.activeSales.reduce((sum, s) => sum + (this.fin(s).total - (this.fin(s).returned || 0)), 0);
    },
    acikAlacak() {
      return this.activeSales.reduce((sum, s) => sum + (this.fin(s).balanceDue || 0), 0);
    },
    musteriSayisi() {
      return new Set(this.activeSales.map((s) => s.customerName).filter(Boolean)).size;
    },
    filteredSales() {
      const q = normalizeSearch(this.search).trim();
      return this.salesData.filter((s) => {
        const matchesSearch = !q || normalizeSearch(`${s.customerName || ''} ${s.productName || ''} #${s._id}`).includes(q);
        const matchesStatus = !this.selectedPaymentStatus || this.fin(s).paymentStatus === this.selectedPaymentStatus;
        const matchesCustomer = !this.selectedCustomer || (s.customerName || '').trim().toLowerCase() === this.selectedCustomer.trim().toLowerCase();
        // Inclusive of the whole selected end day; reversed bounds are swapped.
        const matchesDate = isWithinDayRange(s.date, this.dateFrom, this.dateTo);
        return matchesSearch && matchesStatus && matchesCustomer && matchesDate;
      });
    },
    /** ?customerId= preselects the customer when the cart is opened from a customer page. */
    initialCustomerId() {
      return this.$route.query.customerId ? Number(this.$route.query.customerId) : '';
    },
  },
  async mounted() {
    await this.loadData();
    if (this.$route.query.newSale === '1') this.openNewSaleDialog();
  },
  methods: {
    ...mapActions('sales', { fetchSales: 'fetch' }),
    ...mapActions('customers', { fetchCustomers: 'fetch' }),
    money: formatTry,
    fin: saleFinancial,
    statusLabel: saleStatusLabel,
    statusBadgeClass: saleStatusBadge,
    canCollect,
    canReturn,
    formatDate(value) {
      return dateTime(value);
    },
    async loadData() {
      await Promise.allSettled([this.fetchSales(), this.fetchCustomers(), this.fetchProductsList()]);
    },
    async fetchProductsList() {
      try {
        const data = await apiService.get('/api/products');
        this.availableProducts = (data || []).filter((p) => !p.isArchived);
      } catch {
        this.availableProducts = [];
      }
    },
    openNewSaleDialog() {
      this.dialogs.newSale = true;
    },
    /** Opens one of the row dialogs for `sale`. */
    openDialog(name, sale) {
      this.selectedSale = sale;
      this.dialogs[name] = true;
    },
  },
};
</script>

<style scoped>
.sales-page-shell {
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

/* Sales KPI Ribbon */
.sales-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  flex-shrink: 0;
}

/* Main Table Card */
.sales-main-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 8px 12px;
}

/* Toolbar */
.sales-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--jp-border);
  flex-shrink: 0;
}

.search-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  width: 260px;
}

.search-icon {
  color: var(--jp-text-subtle);
}

.sales-search-field {
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--jp-text);
  font-size: 11px;
  width: 100%;
}
.sales-search-field::placeholder {
  color: var(--jp-text-subtle);
}

.filter-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.compact-select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  color: var(--jp-text);
  font-size: 11px;
  outline: none;
}
.compact-select:focus {
  border-color: var(--jp-gold);
}

.date-range-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.compact-date {
  width: 124px;
  color-scheme: light dark;
}

.date-range-sep {
  font-size: 11px;
  color: var(--jp-text-subtle);
}

.date-range-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--jp-radius-sm);
  color: var(--jp-text-subtle);
}

.date-range-clear:hover {
  color: var(--jp-text);
  background: var(--jp-surface-muted);
}

.record-counter {
  font-size: 11px;
  color: var(--jp-text-subtle);
  margin-left: 6px;
}

/* Table Area */
.table-scroll-wrap {
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
  padding: 8px 10px;
  border-bottom: 1px solid var(--jp-border);
  z-index: 2;
  white-space: nowrap;
}

.jp-enterprise-table tbody td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--jp-border-soft);
  color: var(--jp-text);
  white-space: nowrap;
}

.jp-enterprise-table tbody tr:hover {
  background: var(--jp-surface-card-hover);
}

.product-tag {
  color: var(--jp-text);
  font-weight: 500;
}

.table-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.empty-table-state {
  text-align: center;
  padding: 36px 12px;
  color: var(--jp-text-muted);
}

@media (max-width: 900px) {
  .sales-kpi-row {
    grid-template-columns: repeat(2, 1fr);
  }
  .sales-toolbar,
.filter-controls {
    flex-wrap: wrap;
  }
}
.sales-error-banner {
  color: var(--jp-danger);
  font-size: 11px;
}
.sales-error-banner {
  padding: 6px 0;
  flex-shrink: 0;
}
.text-warning {
  color: var(--jp-warning);
}
.row-cancelled td {
  opacity: 0.55;
}
</style>
