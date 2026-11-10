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
                  <v-btn icon size="x-small" variant="text" color="info" :title="$t('sales.actionView')" :aria-label="$t('sales.actionView')" @click="viewSale(sale)">
                    <v-icon size="15">mdi-eye-outline</v-icon>
                  </v-btn>
                  <v-btn
                    v-if="$can('sales:write') && canCollect(sale)"
                    icon size="x-small" variant="text" color="success" :title="$t('sales.actionCollect')" :aria-label="$t('sales.actionCollect')"
                    @click="openPaymentDialog(sale)"
                  >
                    <v-icon size="15">mdi-cash-plus</v-icon>
                  </v-btn>
                  <v-btn
                    v-if="$can('sales:cancel') && canReturn(sale)"
                    icon size="x-small" variant="text" color="secondary" :title="$t('sales.actionReturn')" :aria-label="$t('sales.actionReturn')"
                    @click="openReturnDialog(sale)"
                  >
                    <v-icon size="15">mdi-keyboard-return</v-icon>
                  </v-btn>
                  <v-btn
                    v-if="$can('sales:write') && sale.status !== 'cancelled'"
                    icon size="x-small" variant="text" color="warning" :title="$t('sales.actionEdit')" :aria-label="$t('sales.actionEdit')"
                    @click="openEditDialog(sale)"
                  >
                    <v-icon size="15">mdi-pencil-outline</v-icon>
                  </v-btn>
                  <v-btn
                    v-if="$can('sales:cancel') && sale.status === 'completed'"
                    icon size="x-small" variant="text" color="error" :title="$t('sales.actionCancel')" :aria-label="$t('sales.actionCancel')"
                    @click="openDeleteDialog(sale)"
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

    <!-- NEW SALE (POS CART) -->
    <v-dialog v-model="newSaleDialog" max-width="760px" persistent>
      <v-card class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="primary" class="mr-2">mdi-lightning-bolt</v-icon>
          {{ $t('sales.dialogNew') }}
        </v-card-title>
        <v-card-text>
          <div class="form-row">
            <label class="form-label" for="sale-customer">{{ $t('sales.customerRequired') }} *</label>
            <select id="sale-customer" v-model="newSale.customerId" class="form-select-full" data-test="sale-customer">
              <option value="" disabled>{{ $t('sales.selectCustomer') }}</option>
              <option v-for="c in customers" :key="c._id" :value="c._id">{{ c.name }} ({{ c.phone || $t('sales.noPhone') }})</option>
            </select>
          </div>

          <!-- USB/Bluetooth scanners type the code and press Enter. -->
          <div class="form-row mt-3">
            <input
              ref="scanInput"
              v-model.trim="scanCode"
              type="text"
              class="form-input-full tabular"
              data-test="sale-scan"
              autocomplete="off"
              :placeholder="$t('sales.scanPlaceholder')"
              :aria-label="$t('sales.scanPlaceholder')"
              @keydown.enter.prevent="onScan"
            />
          </div>

          <div class="cart-lines mt-3">
            <div class="cart-head">
              <span>{{ $t('common.product') }}</span><span class="text-right">{{ $t('common.quantity') }}</span><span class="text-right">{{ $t('sales.col.discountPct') }}</span><span class="text-right">{{ $t('sales.col.unit') }}</span><span class="text-right">{{ $t('common.amount') }}</span><span></span>
            </div>
            <div v-for="(line, index) in newSale.lines" :key="line.key" class="cart-row">
            <select v-model="line.productId" class="form-select-full" :data-test="`sale-product-${index}`" :aria-label="$t('common.product')">
                <option value="" disabled>{{ $t('sales.selectProduct') }}</option>
                <option v-for="p in availableProducts" :key="p._id" :value="p._id" :disabled="p.stock <= 0">
                  {{ p.name }}{{ p.pricingMode === 'gram' ? ` — ${grams(p.weight)} ${purityText(p.purity)}` : ` — ${money(p.price)}` }} ({{ $t('sales.stockShort', { count: $n(p.stock) }) }})
                </option>
              </select>
              <input v-model.number="line.quantity" type="number" min="1" class="form-input-full tabular text-right" :aria-label="$t('common.quantity')" />
              <input v-model.trim="line.discountPercent" type="text" inputmode="decimal" placeholder="0" class="form-input-full tabular text-right" :aria-label="$t('sales.col.discountPct')" />
              <span class="tabular text-right cart-amount">{{ quoteLine(index) ? money(quoteLine(index).unitPrice) : '—' }}</span>
              <span class="tabular text-right cart-amount font-weight-bold">{{ quoteLine(index) ? money(quoteLine(index).total) : '—' }}</span>
              <v-btn icon size="x-small" variant="text" color="error" :disabled="newSale.lines.length === 1" :aria-label="$t('sales.removeLine')" @click="removeLine(index)">
                <v-icon size="15">mdi-close</v-icon>
              </v-btn>
            </div>
            <v-btn size="x-small" variant="text" color="primary" class="mt-1" @click="addLine">
              <v-icon start size="14">mdi-plus</v-icon> {{ $t('sales.addLine') }}
            </v-btn>
          </div>

          <!-- One manual price per metal in the cart; each gram line is priced with ITS metal. -->
          <div v-for="metal in gramMetals" :key="metal" class="form-grid-2 mt-3">
            <div>
            <label class="form-label" :for="`sale-manual-price-${metal}`">{{ $t(metal === 'XAG' ? 'sales.manualSilver' : 'sales.manualGold') }}</label>
              <input :id="`sale-manual-price-${metal}`" v-model.trim="newSale.manualPrices[metal]" type="text" inputmode="decimal" :placeholder="$t('sales.manualGoldPlaceholder')" class="form-input-full tabular" />
            </div>
            <div class="price-source-note">
              <template v-if="metalPriceInfo[metal]">
              {{ $t('sales.priceInfo', { price: $n(metalPriceInfo[metal].pricePerGram), source: metalPriceInfo[metal].priceType === 'manual' ? $t('sales.priceManual') : `${$t('sales.priceLive')} · ${metalPriceInfo[metal].source}` }) }}
              </template>
            </div>
          </div>

          <div class="form-grid-2 mt-3">
            <div>
            <label class="form-label" for="sale-discount">{{ $t('sales.saleDiscount') }}</label>
              <input id="sale-discount" v-model.trim="newSale.saleDiscount" type="text" inputmode="decimal" placeholder="0.00" class="form-input-full tabular" />
            </div>
            <div>
            <label class="form-label" for="sale-notes">{{ $t('common.note') }}</label>
              <input id="sale-notes" v-model.trim="newSale.notes" type="text" maxlength="200" class="form-input-full" />
            </div>
          </div>

          <div class="payments-block mt-3">
            <div class="d-flex align-center justify-space-between mb-1">
              <span class="form-label mb-0">{{ $t('sales.paymentsLabel') }}</span>
              <v-btn size="x-small" variant="text" color="success" :disabled="!quote" @click="payInFull">{{ $t('sales.payInFull') }}</v-btn>
            </div>
            <div v-for="(payment, index) in newSale.payments" :key="payment.key" class="payment-row">
            <select v-model="payment.method" class="form-select-full" :aria-label="$t('sales.paymentMethod')">
                <option value="nakit">{{ $t('payment.cash') }}</option>
                <option value="kredi kartı">{{ $t('payment.card') }}</option>
                <option value="havale">{{ $t('payment.transfer') }}</option>
              </select>
              <input v-model.trim="payment.amount" type="text" inputmode="decimal" placeholder="0.00" class="form-input-full tabular text-right" :aria-label="$t('common.amount')" />
              <v-btn icon size="x-small" variant="text" color="error" :aria-label="$t('sales.removePayment')" @click="newSale.payments.splice(index, 1)">
                <v-icon size="15">mdi-close</v-icon>
              </v-btn>
              <div v-if="payment.method === 'kredi kartı' && posProviders.length" class="pos-row">
              <select v-model="payment.providerId" class="form-select-full" aria-label="POS">
                  <option value="" disabled>{{ $t('sales.selectPos') }}</option>
                  <option v-for="pp in posProviders" :key="pp._id" :value="pp._id">{{ pp.name }}</option>
                </select>
              <select v-model.number="payment.installments" class="form-select-full" :aria-label="$t('sales.installmentLabel')">
                  <option v-for="n in installmentsOf(payment.providerId)" :key="n" :value="n">{{ installmentText(n) }}</option>
                </select>
              </div>
            </div>
            <v-btn size="x-small" variant="text" color="primary" :disabled="newSale.payments.length >= 4" @click="addPayment()">
              <v-icon start size="14">mdi-plus</v-icon> {{ $t('sales.addPayment') }}
            </v-btn>
          </div>

          <div class="transaction-summary-box mt-3">
            <div v-if="quoting" class="text-caption text-disabled">{{ $t('sales.quoting') }}</div>
            <div v-else-if="quoteError" class="quote-error">{{ quoteError }}</div>
            <template v-else-if="quote">
            <div class="summary-line"><span>{{ $t('sales.subtotal') }}</span><strong class="tabular">{{ money(quote.subtotal) }}</strong></div>
              <div class="summary-line"><span>{{ $t('sales.discounts') }}</span><strong class="tabular">−{{ money(quote.discount) }}</strong></div>
              <div class="summary-line total-line"><span>{{ $t('sales.grandTotal') }}</span><strong class="tabular text-success">{{ money(quote.total) }}</strong></div>
              <div class="summary-line"><span>{{ $t('sales.paid') }}</span><strong class="tabular">{{ money(quote.paid) }}</strong></div>
              <div class="summary-line"><span>{{ $t('sales.toAccount') }}</span><strong class="tabular" :class="quote.balanceDue > 0 ? 'text-warning' : ''">{{ money(quote.balanceDue) }}</strong></div>
            </template>
            <div v-else class="text-caption text-disabled">{{ $t('sales.quoteHint') }}</div>
          </div>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" :disabled="savingSale" @click="newSaleDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn size="small" class="jp-primary" :loading="savingSale" :disabled="!canSubmitSale" data-test="sale-submit" @click="submitNewSale">
            <v-icon start size="14">mdi-check</v-icon>
            {{ $t('sales.complete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- VIEW SALE -->
    <v-dialog v-model="viewDialog" max-width="640px">
      <v-card class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="info" class="mr-2">mdi-receipt-text</v-icon>
          {{ $t('sales.receiptTitle', { id: selectedSale?._id }) }}
        </v-card-title>
        <v-card-text v-if="selectedSale">
          <div class="receipt-grid">
            <div class="receipt-row"><span class="label">{{ $t('common.customer') }}</span><strong class="val">{{ selectedSale.customerName || '—' }}</strong></div>
            <div class="receipt-row"><span class="label">{{ $t('common.date') }}</span><span class="val tabular">{{ formatDate(selectedSale.date) }}</span></div>
            <div class="receipt-row"><span class="label">{{ $t('common.status') }}</span><span class="jp-badge" :class="statusBadgeClass(selectedSale)">{{ statusLabel(selectedSale) }}</span></div>
          </div>
          <table v-if="selectedSale.lines && selectedSale.lines.length" class="jp-enterprise-table mt-3">
            <thead>
              <tr><th>{{ $t('common.product') }}</th><th class="text-right">{{ $t('common.quantity') }}</th><th class="text-right">{{ $t('sales.col.unit') }}</th><th class="text-right">{{ $t('common.amount') }}</th><th class="text-right">{{ $t('sales.col.returned') }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="line in selectedSale.lines" :key="line.lineId">
                <td>
                  {{ line.productName }}
                  <div v-if="line.pricingMode === 'gram'" class="text-caption text-disabled">
                  {{ grams(line.weightGramsPerUnit) }} · {{ purityText(line.purity) }} · {{ $t('sales.labor', { value: laborText(line) }) }} ·
                    {{ $money(line.price?.pricePerGram) }}/{{ $t('units.gram') }} ({{ line.price?.priceType === 'manual' ? $t('sales.priceManual') : $t('sales.priceLive') }})
                  </div>
                </td>
              <td class="text-right tabular">{{ $n(line.quantity) }}</td>
                <td class="text-right tabular">{{ money(line.unitPrice) }}</td>
                <td class="text-right tabular">{{ money(line.total) }}</td>
                <td class="text-right tabular">{{ $n(line.returnedQuantity || 0) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="receipt-grid mt-3">
            <div class="receipt-row"><span class="label">{{ $t('common.total') }}</span><strong class="val tabular">{{ money(fin(selectedSale).total) }}</strong></div>
            <div class="receipt-row"><span class="label">{{ $t('sales.returnedAmount') }}</span><span class="val tabular">{{ money(fin(selectedSale).returned) }}</span></div>
            <div class="receipt-row"><span class="label">{{ $t('sales.paidNet') }}</span><span class="val tabular">{{ money(fin(selectedSale).paid) }}</span></div>
            <div class="receipt-row total-receipt-row"><span class="label">{{ $t('sales.col.balance') }}</span><strong class="val tabular">{{ money(fin(selectedSale).balanceDue) }}</strong></div>
          </div>
          <div v-if="selectedSale.payments && selectedSale.payments.length" class="mt-3">
            <div class="form-label">{{ $t('sales.paymentHistory') }}</div>
            <div v-for="(p, i) in selectedSale.payments" :key="i" class="text-caption tabular">
              {{ formatDate(p.at) }} · {{ p.kind === 'refund' ? $t('sales.refund') : $t('sales.collection') }} · {{ $payment(p.method) }} · {{ money(p.amount) }}
            </div>
          </div>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn v-if="selectedSale" size="small" class="jp-secondary" data-test="print-receipt" @click="printReceipt(selectedSale)">
            <v-icon start size="14">mdi-printer-outline</v-icon>
            {{ $t('sales.printReceipt') }}
          </v-btn>
          <v-btn size="small" class="jp-secondary" @click="viewDialog = false">{{ $t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- PAYMENT AGAINST SALE -->
    <v-dialog v-model="paymentDialog" max-width="420px" persistent>
      <v-card class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="success" class="mr-2">mdi-cash-plus</v-icon>
          {{ $t('sales.paymentTitle', { id: paymentTarget?._id }) }}
        </v-card-title>
        <v-card-text>
          <div class="text-caption text-disabled mb-2">{{ $t('sales.outstanding') }}: <strong class="tabular">{{ money(paymentTarget ? fin(paymentTarget).balanceDue : 0) }}</strong></div>
          <div class="form-grid-2">
            <div>
            <label class="form-label" for="pay-method">{{ $t('sales.paymentMethod') }}</label>
              <select id="pay-method" v-model="paymentForm.method" class="form-select-full">
                <option value="nakit">{{ $t('payment.cash') }}</option>
                <option value="kredi kartı">{{ $t('payment.card') }}</option>
                <option value="havale">{{ $t('payment.transfer') }}</option>
              </select>
            </div>
            <div>
              <label class="form-label" for="pay-amount">{{ $t('sales.amountTry') }}</label>
              <input id="pay-amount" v-model.trim="paymentForm.amount" type="text" inputmode="decimal" class="form-input-full tabular" />
            </div>
          </div>
          <div v-if="paymentForm.method === 'kredi kartı' && posProviders.length" class="form-grid-2 mt-2">
            <div>
            <label class="form-label" for="pay-pos">POS</label>
              <select id="pay-pos" v-model="paymentForm.providerId" class="form-select-full">
                <option value="" disabled>{{ $t('common.select') }}</option>
                <option v-for="pp in posProviders" :key="pp._id" :value="pp._id">{{ pp.name }}</option>
              </select>
            </div>
            <div>
            <label class="form-label" for="pay-inst">{{ $t('sales.installmentLabel') }}</label>
              <select id="pay-inst" v-model.number="paymentForm.installments" class="form-select-full">
                <option v-for="n in installmentsOf(paymentForm.providerId)" :key="n" :value="n">{{ installmentText(n) }}</option>
              </select>
            </div>
          </div>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" :disabled="saving" @click="paymentDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn size="small" class="jp-primary" :loading="saving" :disabled="!isValidAmount(paymentForm.amount)" @click="submitPayment">{{ $t('sales.collect') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- RETURN -->
    <v-dialog v-model="returnDialog" max-width="560px" persistent>
      <v-card class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="secondary" class="mr-2">mdi-keyboard-return</v-icon>
          {{ $t('sales.returnTitle', { id: returnTarget?._id }) }}
        </v-card-title>
        <v-card-text v-if="returnTarget">
          <table class="jp-enterprise-table">
            <thead><tr><th>{{ $t('common.product') }}</th><th class="text-right">{{ $t('sales.col.sold') }}</th><th class="text-right">{{ $t('sales.col.returnable') }}</th><th class="text-right" style="width: 90px;">{{ $t('sales.col.returnQty') }}</th></tr></thead>
            <tbody>
              <tr v-for="line in returnTarget.lines" :key="line.lineId">
                <td>{{ line.productName }}</td>
              <td class="text-right tabular">{{ $n(line.quantity) }}</td>
                <td class="text-right tabular">{{ $n(line.quantity - (line.returnedQuantity || 0)) }}</td>
                <td><input v-model.number="returnForm.quantities[line.lineId]" :aria-label="$t('sales.col.returnQty')" type="number" min="0" :max="line.quantity - (line.returnedQuantity || 0)" class="form-input-full tabular text-right" /></td>
              </tr>
            </tbody>
          </table>
          <div class="form-grid-2 mt-3">
            <div>
            <label class="form-label" for="ret-method">{{ $t('sales.refundMethod') }}</label>
              <select id="ret-method" v-model="returnForm.refundMethod" class="form-select-full">
                <option value="cari">{{ $t('sales.refundToAccount') }}</option>
                <option value="nakit">{{ $t('sales.refundCash') }}</option>
                <option value="kredi kartı">{{ $t('sales.refundCard') }}</option>
                <option value="havale">{{ $t('sales.refundTransfer') }}</option>
              </select>
            </div>
            <div>
              <label class="form-label" for="ret-reason">{{ $t('sales.returnReason') }}</label>
              <input id="ret-reason" v-model.trim="returnForm.reason" type="text" maxlength="200" class="form-input-full" />
            </div>
          </div>
          <p class="text-caption text-disabled mt-2">{{ $t('sales.returnHint') }}</p>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" :disabled="saving" @click="returnDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn size="small" class="jp-primary" :loading="saving" :disabled="!returnLines.length" @click="submitReturn">{{ $t('sales.saveReturn') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- EDIT (notes; legacy sales also payment method / date) -->
    <v-dialog v-model="editDialog" max-width="480px">
      <v-card class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="warning" class="mr-2">mdi-pencil</v-icon>
          {{ $t('sales.editTitle', { id: editForm?._id }) }}
        </v-card-title>
        <v-card-text>
          <p class="text-caption text-disabled mb-3">{{ $t('sales.editHint') }}</p>
          <template v-if="editForm.legacy">
            <div class="form-row">
              <label class="form-label" for="edit-method">{{ $t('sales.legacyPayment') }}</label>
              <select id="edit-method" v-model="editForm.paymentMethod" class="form-select-full">
                <option value="nakit">{{ $t('payment.cash') }}</option>
                <option value="kredi kartı">{{ $t('payment.card') }}</option>
                <option value="havale">{{ $t('payment.transfer') }}</option>
              </select>
            </div>
            <div class="form-row mt-3">
              <label class="form-label" for="edit-date">{{ $t('sales.legacyDate') }}</label>
              <input id="edit-date" v-model="editForm.date" type="date" class="form-input-full" />
            </div>
          </template>
          <div class="form-row mt-3">
            <label class="form-label" for="edit-notes">{{ $t('common.note') }}</label>
            <input id="edit-notes" v-model.trim="editForm.notes" type="text" maxlength="200" class="form-input-full" />
          </div>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" @click="editDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn size="small" class="jp-primary" :loading="saving" @click="saveEdit">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- CANCEL -->
    <v-dialog v-model="deleteDialog" max-width="440px">
      <v-card class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="error" class="mr-2">mdi-alert-circle</v-icon>
          {{ $t('sales.cancelTitle') }}
        </v-card-title>
        <v-card-text class="text-caption">
          <strong>{{ $t('sales.cancelIntro', { id: deleteTarget?._id }) }}</strong>
          <ul class="mt-2 ms-4">
            <li>{{ $t('sales.cancelStock') }}</li>
            <li>{{ $t('sales.cancelLedger') }}</li>
            <li>{{ $t('sales.cancelPayments') }}</li>
          </ul>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" @click="deleteDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn size="small" class="jp-btn-danger" :loading="saving" @click="confirmDelete">{{ $t('sales.cancelTitle') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { mapActions, mapState } from 'vuex';
import apiService from '@/services/api';
import {
  normalizeDecimalInput, isValidAmount, newIdempotencyKey, formatTry, formatGrams, purityLabel, errorMessage, crossBranchTarget,
  PAYMENT_STATUS_LABELS, SALE_STATUS_LABELS,
} from '@/services/finance';
import { confirmAction } from '@/services/confirm';
import { dateTime, n, normalizeSearch, t } from '@/i18n';
import { isWithinDayRange } from '@/services/periodFilters';
import { hasPermission } from '@/services/authSession';
import { posBlock } from '@/services/operations';
import { gramMetalsOf, manualPricesPayload, quotedMetalPrices } from '@/services/salePricing';
import { addScannedProduct, resolveScan } from '@/services/barcode';
import { buildReceiptHtml } from '@/services/receipt';
import { printDocument } from '@/services/print';
import { fetchBusinessProfile } from '@/services/businessProfile';

const emptyManualPrices = () => ({ XAU: '', XAG: '' });

let lineSeq = 0;
const newLine = (productId = '') => ({ key: `l${(lineSeq += 1)}`, productId, quantity: 1, discountPercent: '' });
const newPayment = (method = 'nakit', amount = '') => ({ key: `p${(lineSeq += 1)}`, method, amount, providerId: '', installments: 1 });

export default {
  name: 'SalesPage',
  data() {
    return {
      search: '',
      selectedPaymentStatus: '',
      selectedCustomer: '',
      dateFrom: '',
      dateTo: '',
      viewDialog: false,
      editDialog: false,
      deleteDialog: false,
      newSaleDialog: false,
      paymentDialog: false,
      returnDialog: false,
      savingSale: false,
      saving: false,
      selectedSale: null,
      editForm: {},
      deleteTarget: null,
      posProviders: [],
      paymentTarget: null,
      paymentForm: { method: 'nakit', amount: '', key: '' },
      returnTarget: null,
      returnForm: { quantities: {}, refundMethod: 'cari', reason: '', key: '' },
      newSale: { customerId: '', lines: [newLine()], payments: [], saleDiscount: '', manualPrices: emptyManualPrices(), notes: '' },
      scanCode: '',
      saleKey: '',
      quote: null,
      quoting: false,
      quoteError: '',
      quoteTimer: null,
      quoteSeq: 0,
      availableProducts: [],
    };
  },
  computed: {
    /** With exactly one active POS the server picks it; send it explicitly anyway. */
    defaultProviderId() {
      return this.posProviders.length === 1 ? this.posProviders[0]._id : '';
    },
    ...mapState('sales', ['sales', 'loading', 'error']),
    ...mapState('customers', { customers: 'customers' }),
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
    gramMetals() {
      return gramMetalsOf(this.newSale.lines, (id) => this.productById(id));
    },
    metalPriceInfo() {
      return quotedMetalPrices(this.quote?.lines);
    },
    salePayload() {
      const lines = this.newSale.lines
        .filter((l) => l.productId)
        .map((l) => ({
          productId: Number(l.productId),
          quantity: Number(l.quantity) || 1,
          ...(normalizeDecimalInput(l.discountPercent) ? { discount: { type: 'percent', value: normalizeDecimalInput(l.discountPercent) } } : {}),
        }));
      const payload = {
        customerId: Number(this.newSale.customerId),
        lines,
        payments: this.newSale.payments
          .filter((p) => normalizeDecimalInput(p.amount))
          .map((p) => {
            const pos = posBlock(p.method, p.providerId || this.defaultProviderId, p.installments);
            return { method: p.method, amount: normalizeDecimalInput(p.amount), ...(pos ? { pos } : {}) };
          }),
      };
      if (normalizeDecimalInput(this.newSale.saleDiscount)) payload.discount = { type: 'amount', value: normalizeDecimalInput(this.newSale.saleDiscount) };
      const manualPrices = manualPricesPayload(this.gramMetals, this.newSale.manualPrices);
      if (manualPrices) payload.manualPrices = manualPrices;
      if (this.newSale.notes) payload.notes = this.newSale.notes;
      return payload;
    },
    canSubmitSale() {
      return Boolean(this.newSale.customerId) && this.salePayload.lines.length > 0 && Boolean(this.quote) && !this.quoteError && !this.quoting;
    },
    returnLines() {
      return Object.entries(this.returnForm.quantities)
        .map(([lineId, quantity]) => ({ lineId: Number(lineId), quantity: Number(quantity) || 0 }))
        .filter((l) => l.quantity > 0);
    },
  },
  watch: {
    salePayload: {
      deep: true,
      handler() {
        if (this.newSaleDialog) this.scheduleQuote();
      },
    },
  },
  async mounted() {
    await this.loadData();
    if (this.$route.query.newSale === '1') this.openNewSaleDialog();
  },
  beforeUnmount() {
    clearTimeout(this.quoteTimer);
  },
  methods: {
    ...mapActions('sales', ['fetchSales']),
    ...mapActions('customers', { fetchCustomers: 'fetchCustomers' }),
    isValidAmount,
    money: formatTry,
    grams: formatGrams,
    purityText: purityLabel,
    fin(sale) {
      return sale?.financial || { total: sale?.totalPrice || 0, paid: sale?.totalPrice || 0, balanceDue: 0, returned: 0, paymentStatus: 'paid' };
    },
    statusLabel(sale) {
      if (sale.status && sale.status !== 'completed') return SALE_STATUS_LABELS[sale.status] || sale.status;
      return PAYMENT_STATUS_LABELS[this.fin(sale).paymentStatus] || t('status.sale.completed');
    },
    statusBadgeClass(sale) {
      if (sale.status === 'cancelled') return 'jp-badge-danger';
      if (sale.status === 'returned' || sale.status === 'partially_returned') return 'jp-badge-info';
      const status = this.fin(sale).paymentStatus;
      if (status === 'partial') return 'jp-badge-warning';
      if (status === 'unpaid') return 'jp-badge-warning';
      return 'jp-badge-success';
    },
    canCollect(sale) {
      return Boolean(sale.financial?.journaled) && sale.status !== 'cancelled' && this.fin(sale).balanceDue > 0;
    },
    canReturn(sale) {
      return Boolean(sale.financial?.journaled) && Array.isArray(sale.lines) && ['completed', 'partially_returned'].includes(sale.status);
    },
    laborText(line) {
      if (!line.laborType || line.laborType === 'none') return 'yok';
      if (line.laborType === 'milyem') return `${line.laborValue}‰`;
      if (line.laborType === 'per_gram') return `${line.laborValue} TL/g`;
      return `${line.laborValue} TL`;
    },
    productById(id) {
      return this.availableProducts.find((p) => p._id === Number(id));
    },
    quoteLine(index) {
      if (!this.quote) return null;
      const position = this.newSale.lines.slice(0, index + 1).filter((l) => l.productId).length - 1;
      return this.newSale.lines[index].productId ? this.quote.lines[position] : null;
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
      const queryCustId = this.$route.query.customerId ? Number(this.$route.query.customerId) : null;
      const initialCustId = queryCustId && this.customers.some((c) => c._id === queryCustId) ? queryCustId : '';
      this.newSale = { customerId: initialCustId, lines: [newLine()], payments: [newPayment('nakit')], saleDiscount: '', manualPrices: emptyManualPrices(), notes: '' };
      this.quote = null;
      this.quoteError = '';
      // One key per sale attempt: a retried submit of the same cart is applied once.
      this.saleKey = newIdempotencyKey('sale');
      this.loadPosProviders();
      this.newSaleDialog = true;
      // The dialog renders lazily; focus the scan field once it is in the DOM.
      setTimeout(() => this.$refs.scanInput?.focus(), 150);
    },
    addLine() {
      this.newSale.lines.push(newLine());
    },
    /** Barcode scan (keyboard wedge): adds one unit of the scanned product. */
    onScan() {
      const result = resolveScan(this.availableProducts, this.scanCode);
      this.scanCode = '';
      if (result.status === 'empty') return;
      if (result.status === 'not_found') {
        this.$store.dispatch('notifications/showWarning', t('sales.scanNotFound', { code: result.code }));
        return;
      }
      if (result.status === 'out_of_stock') {
        this.$store.dispatch('notifications/showWarning', t('sales.scanOutOfStock', { name: result.product.name }));
        return;
      }
      const { capped } = addScannedProduct(this.newSale.lines, result.product, () => newLine());
      if (capped) this.$store.dispatch('notifications/showWarning', t('sales.scanCapped', { name: result.product.name }));
      this.$nextTick(() => this.$refs.scanInput?.focus());
    },
    async printReceipt(sale) {
      let profile = {};
      try {
        profile = await fetchBusinessProfile();
      } catch {
        // The slip still prints without the header.
      }
      const labels = Object.fromEntries(
        ['title', 'saleNo', 'date', 'customer', 'product', 'quantity', 'total', 'subtotal', 'discount', 'vatIncluded', 'paid', 'balanceDue', 'taxOffice', 'taxNumber', 'notInvoice']
          .map((key) => [key, t(`sales.receipt.${key}`)]),
      );
      printDocument(buildReceiptHtml(sale, profile, labels, {
        money: (value) => formatTry(value),
        date: (value) => dateTime(value),
        number: (value) => n(value),
      }));
    },
    /** Active POS providers of this branch (commission is computed by the server at capture). */
    async loadPosProviders() {
      if (!hasPermission('sales:write')) return;
      try {
        this.posProviders = (await apiService.get('/api/pos/providers/active')) || [];
      } catch {
        this.posProviders = [];
      }
    },
    installmentsOf(providerId) {
      const provider = this.posProviders.find((p) => p._id === (providerId || this.defaultProviderId));
      return provider ? provider.installments : [1];
    },
    removeLine(index) {
      this.newSale.lines.splice(index, 1);
    },
    addPayment(method = 'nakit', amount = '') {
      this.newSale.payments.push(newPayment(method, amount));
    },
    payInFull() {
      if (!this.quote) return;
      const method = this.newSale.payments[0]?.method || 'nakit';
      this.newSale.payments = [newPayment(method, '')];
      // The quote's "paid" already counts typed payments; pay the full total.
      this.newSale.payments[0].amount = this.quote.total.toFixed(2);
    },
    scheduleQuote() {
      clearTimeout(this.quoteTimer);
      this.quoteError = '';
      if (!this.newSale.customerId || !this.salePayload.lines.length) {
        this.quote = null;
        return;
      }
      this.quoteTimer = setTimeout(() => this.fetchQuote(), 300);
    },
    async fetchQuote() {
      const seq = (this.quoteSeq += 1);
      this.quoting = true;
      try {
        const quote = await apiService.post('/api/sales/quote', this.salePayload);
        if (seq !== this.quoteSeq) return;
        this.quote = quote;
        this.quoteError = '';
      } catch (err) {
        if (seq !== this.quoteSeq) return;
        this.quote = null;
        this.quoteError = err.code === 'MARKET_PRICE_UNAVAILABLE'
          ? t('sales.livePriceUnavailable')
          : errorMessage(err);
      } finally {
        if (seq === this.quoteSeq) this.quoting = false;
      }
    },
    async submitNewSale() {
      if (!this.canSubmitSale) return;
      this.savingSale = true;
      try {
        try {
          await apiService.post('/api/sales', this.salePayload, { headers: { 'Idempotency-Key': this.saleKey } });
        } catch (err) {
          // Admin selling another branch's stock: the branch must be confirmed explicitly.
          const branch = crossBranchTarget(err);
          if (!branch || !(await confirmAction({
            message: t('sales.crossBranch', { branch }),
            confirmLabel: t('sales.crossBranchConfirm', { branch }),
            tone: 'warning',
          }))) throw err;
          await apiService.post('/api/sales', { ...this.salePayload, branch }, { headers: { 'Idempotency-Key': this.saleKey } });
        }
        this.$store.dispatch('notifications/showSuccess', t('sales.saved'));
        this.newSaleDialog = false;
        await this.loadData();
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('sales.saveFailed', { reason: errorMessage(err) }));
      } finally {
        this.savingSale = false;
      }
    },
    viewSale(sale) {
      this.selectedSale = sale;
      this.viewDialog = true;
    },
    openPaymentDialog(sale) {
      this.paymentTarget = sale;
      this.paymentForm = { method: 'nakit', amount: this.fin(sale).balanceDue.toFixed(2), providerId: this.defaultProviderId, installments: 1, key: newIdempotencyKey('pay') };
      this.loadPosProviders();
      this.paymentDialog = true;
    },
    async submitPayment() {
      this.saving = true;
      try {
        const pos = posBlock(this.paymentForm.method, this.paymentForm.providerId || this.defaultProviderId, this.paymentForm.installments);
        await apiService.post(`/api/sales/${this.paymentTarget._id}/payments`, {
          method: this.paymentForm.method,
          amount: normalizeDecimalInput(this.paymentForm.amount),
          ...(pos ? { pos } : {}),
        }, { headers: { 'Idempotency-Key': this.paymentForm.key } });
        this.$store.dispatch('notifications/showSuccess', t('sales.paymentSaved'));
        this.paymentDialog = false;
        await this.fetchSales();
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('sales.paymentFailed', { reason: errorMessage(err) }));
      } finally {
        this.saving = false;
      }
    },
    openReturnDialog(sale) {
      this.returnTarget = sale;
      this.returnForm = { quantities: {}, refundMethod: this.fin(sale).paid > 0 ? 'nakit' : 'cari', reason: '', key: newIdempotencyKey('return') };
      this.returnDialog = true;
    },
    async submitReturn() {
      this.saving = true;
      try {
        await apiService.post(`/api/sales/${this.returnTarget._id}/returns`, {
          lines: this.returnLines,
          refundMethod: this.returnForm.refundMethod,
          reason: this.returnForm.reason || undefined,
        }, { headers: { 'Idempotency-Key': this.returnForm.key } });
        this.$store.dispatch('notifications/showSuccess', t('sales.returnSaved'));
        this.returnDialog = false;
        await this.loadData();
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('sales.returnFailed', { reason: errorMessage(err) }));
      } finally {
        this.saving = false;
      }
    },
    openEditDialog(sale) {
      this.editForm = {
        _id: sale._id,
        legacy: !sale.financial?.journaled,
        paymentMethod: sale.paymentMethod || 'nakit',
        date: sale.date ? sale.date.split('T')[0] : '',
        notes: sale.notes || '',
      };
      this.editDialog = true;
    },
    async saveEdit() {
      this.saving = true;
      try {
        const payload = { notes: this.editForm.notes };
        if (this.editForm.legacy) {
          payload.paymentMethod = this.editForm.paymentMethod;
          if (this.editForm.date) payload.date = this.editForm.date;
        }
        await apiService.put(`/api/sales/${this.editForm._id}`, payload);
        this.$store.dispatch('notifications/showSuccess', t('sales.updated'));
        this.editDialog = false;
        await this.fetchSales();
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('sales.updateFailed', { reason: errorMessage(err) }));
      } finally {
        this.saving = false;
      }
    },
    openDeleteDialog(sale) {
      this.deleteTarget = sale;
      this.deleteDialog = true;
    },
    async confirmDelete() {
      this.saving = true;
      try {
        await apiService.delete(`/api/sales/${this.deleteTarget._id}`);
        this.$store.dispatch('notifications/showSuccess', t('sales.cancelled'));
        this.deleteDialog = false;
        await this.loadData();
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('sales.cancelFailed', { reason: errorMessage(err) }));
      } finally {
        this.saving = false;
      }
    },
    formatDate(dateStr) {
      return dateTime(dateStr);
    },
    installmentText(count) {
      return count === 1 ? t('sales.singlePayment') : t('sales.installments', { count });
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

/* POS Dialog Styles */
.dialog-header {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--jp-border);
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--jp-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.form-select-full,
.form-input-full {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  color: var(--jp-text-emphasis);
  font-size: 12px;
  outline: none;
}
.form-select-full:focus,
.form-input-full:focus {
  border-color: var(--jp-gold);
}

.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.transaction-summary-box {
  padding: 10px 14px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-gold-subtle);
  border: 1px solid var(--jp-gold-border);
}

.summary-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  margin-bottom: 4px;
}

.total-line {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--jp-gold-border);
  font-size: 13px;
}

.dialog-actions {
  padding: 10px 14px;
  border-top: 1px solid var(--jp-border);
}

/* Receipt Details */
.receipt-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
}

.receipt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--jp-border-soft);
}
.receipt-row .label {
  color: var(--jp-text-muted);
}
.total-receipt-row {
  padding-top: 8px;
  border-top: 1px solid var(--jp-border-light);
  font-size: 14px;
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
/* POS cart */
.cart-lines {
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  padding: 8px;
  background: var(--jp-surface-muted);
}
.cart-head,
.cart-row {
  display: grid;
  grid-template-columns: 1fr 64px 64px 104px 112px 28px;
  gap: 6px;
  align-items: center;
}
.cart-head {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--jp-text-subtle);
  padding-bottom: 4px;
}
.cart-row + .cart-row {
  margin-top: 6px;
}
.cart-amount {
  font-size: 11px;
}
.payment-row {
  display: grid;
  grid-template-columns: 1fr 140px 28px;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.pos-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 140px;
  gap: 6px;
}
.price-source-note {
  display: flex;
  align-items: flex-end;
  font-size: 11px;
  color: var(--jp-text-subtle);
  padding-bottom: 8px;
}
.quote-error,
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
@media (max-width: 720px) {
  .cart-head { display: none; }
  .cart-row { grid-template-columns: 1fr 56px 56px; }
  .cart-row .cart-amount { display: none; }
}
</style>
