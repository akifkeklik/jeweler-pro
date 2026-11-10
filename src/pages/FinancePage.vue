<template>
  <div class="jp-page-shell finance-page-shell">
    <div class="jp-page-header">
      <div class="page-heading-left">
        <div>
          <div class="jp-section-label">{{ $t('finance.alimStokVeMuhasebe') }}</div>
          <h1 class="page-title">
            <v-icon size="20" color="primary">mdi-bank-outline</v-icon>
            {{ $t('finance.alimFinans') }}
          </h1>
        </div>
      </div>
      <div class="header-actions">
        <v-btn size="small" class="jp-secondary" :loading="loading" @click="loadTab">
          <v-icon start size="14">mdi-refresh</v-icon>
          {{ $t('common.refresh') }}
        </v-btn>
      </div>
    </div>

    <div class="finance-tabs">
      <button v-for="tab in visibleTabs" :key="tab.id" type="button" class="finance-tab" :class="{ active: activeTab === tab.id }" @click="selectTab(tab.id)">
        <v-icon size="14" class="mr-1">{{ tab.icon }}</v-icon>{{ tab.label }}
      </button>
    </div>

    <div class="jp-card finance-card">
      <div v-if="loadError" class="finance-error">{{ loadError }}</div>

      <!-- SUPPLIERS -->
      <template v-if="activeTab === 'suppliers'">
        <div class="finance-toolbar">
          <span class="record-counter tabular">{{ $t('finance.p0TedarikciToplamBorcP1', { p0: suppliers.length, p1: money(totalPayable) }) }}</span>
          <v-btn v-if="$can('purchases:write')" size="small" class="jp-primary" @click="openSupplierDialog">
            <v-icon start size="14">mdi-plus</v-icon> {{ $t('finance.tedarikciEkle') }}
          </v-btn>
        </div>
        <div class="table-scroll-wrap">
          <table class="jp-enterprise-table">
            <thead><tr><th>{{ $t('finance.tedarikci') }}</th><th>{{ $t('finance.telefon') }}</th><th>{{ $t('finance.vergiNo') }}</th><th class="text-right">{{ $t('finance.bakiyeBorcumuz') }}</th><th class="text-center" style="width: 120px;">{{ $t('finance.islemler') }}</th></tr></thead>
            <tbody>
              <tr v-for="s in suppliers" :key="s._id">
                <td class="font-weight-medium">{{ s.name }}</td>
                <td>{{ s.phone || '—' }}</td>
                <td class="tabular">{{ s.taxNumber || '—' }}</td>
                <td class="text-right tabular font-weight-bold" :class="s.balanceTry > 0 ? 'text-warning' : 'text-disabled'">{{ money(s.balanceTry) }}</td>
                <td class="text-center">
                  <v-btn icon size="x-small" variant="text" color="info" :title="$t('finance.ekstre')" @click="openStatement(s)"><v-icon size="15">mdi-file-document-outline</v-icon></v-btn>
                  <v-btn v-if="$can('cash:write') && s.balanceTry > 0" icon size="x-small" variant="text" color="success" :title="$t('finance.odemeYap')" @click="openSupplierPayment(s)"><v-icon size="15">mdi-cash-minus</v-icon></v-btn>
                </td>
              </tr>
              <tr v-if="!loading && !suppliers.length"><td colspan="5" class="empty-table-state">{{ $t('finance.henuzTedarikciKaydiYok') }}</td></tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- PURCHASES -->
      <template v-if="activeTab === 'purchases'">
        <div class="finance-toolbar">
          <span class="record-counter tabular">{{ $t('finance.p0AlisAcikBorcP1', { p0: purchases.length, p1: money(openPurchases) }) }}</span>
          <v-btn v-if="$can('purchases:write')" size="small" class="jp-primary" :disabled="!suppliers.length" @click="openPurchaseDialog">
            <v-icon start size="14">mdi-plus</v-icon> {{ $t('finance.yeniAlis') }}
          </v-btn>
        </div>
        <div class="table-scroll-wrap">
          <table class="jp-enterprise-table">
            <thead><tr><th>{{ $t('finance.alisNo') }}</th><th>{{ $t('finance.tedarikci') }}</th><th>{{ $t('common.invoice') }}</th><th class="text-right">{{ $t('common.total') }}</th><th class="text-right">{{ $t('finance.iadeFark') }}</th><th class="text-right">{{ $t('finance.odenen') }}</th><th class="text-right">{{ $t('sales.col.balance') }}</th><th>{{ $t('common.status') }}</th><th class="text-right">{{ $t('finance.tarih') }}</th><th class="text-center" style="width: 140px;">{{ $t('finance.islemler') }}</th></tr></thead>
            <tbody>
              <tr v-for="p in purchases" :key="p._id" :class="{ 'row-cancelled': p.status === 'cancelled' }">
                <td class="tabular text-caption font-weight-bold">#{{ p._id }}</td>
                <td>{{ p.supplierName || p.supplierId }}</td>
                <td class="tabular">{{ p.invoiceNo || '—' }}</td>
                <td class="text-right tabular">{{ money(p.total) }}</td>
                <td class="text-right tabular" :class="p.returned ? '' : 'text-disabled'">{{ p.returned ? `−${money(p.returned)}` : '—' }}</td>
                <td class="text-right tabular">{{ money(p.netPaid ?? p.paid) }}</td>
                <td class="text-right tabular" :class="p.remaining > 0 ? 'text-warning font-weight-bold' : 'text-disabled'">
                  {{ money(p.remaining) }}
                  <div v-if="p.supplierCredit > 0" class="text-caption text-success">{{ $t('finance.alacagimizP0', { p0: money(p.supplierCredit) }) }}</div>
                </td>
                <td><span class="jp-badge" :class="purchaseBadge(p)">{{ purchaseStatus(p) }}</span></td>
                <td class="text-right tabular text-caption text-disabled">{{ formatDate(p.date) }}</td>
                <td class="text-center">
                  <v-btn v-if="$can('purchases:write') && p.status !== 'cancelled' && p.remaining > 0" icon size="x-small" variant="text" color="success" :title="$t('finance.odeme')" @click="openPurchasePayment(p)"><v-icon size="15">mdi-cash-minus</v-icon></v-btn>
                  <v-btn v-if="$can('purchases:write') && p.status !== 'cancelled' && p.returnStatus !== 'full'" icon size="x-small" variant="text" color="primary" :title="$t('finance.iadeFiyatFarki')" @click="openReturn(p)"><v-icon size="15">mdi-keyboard-return</v-icon></v-btn>
                  <v-btn v-if="$can('purchases:write') && p.supplierCredit > 0" icon size="x-small" variant="text" color="info" :title="$t('finance.tedarikciGeriOdemesi')" @click="openRefund(p)"><v-icon size="15">mdi-cash-refund</v-icon></v-btn>
                  <v-btn v-if="$can('purchases:write') && p.status !== 'cancelled' && (!p.returnStatus || p.returnStatus === 'none')" icon size="x-small" variant="text" color="error" :title="$t('finance.iptal')" @click="cancelPurchase(p)"><v-icon size="15">mdi-cancel</v-icon></v-btn>
                </td>
              </tr>
              <tr v-if="!loading && !purchases.length"><td colspan="10" class="empty-table-state">{{ $t('finance.henuzAlisKaydiYok') }}</td></tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- STOCK MOVEMENTS & METAL -->
      <template v-if="activeTab === 'inventory'">
        <div class="finance-toolbar">
          <span class="record-counter tabular">{{ $t('finance.sonP0StokHareketi', { p0: movements.length }) }}</span>
          <span v-if="metalPools.length" class="record-counter tabular">
            {{ $t('finance.madenStogu') }} <template v-for="(m, i) in metalPools" :key="i">{{ $t('finance.p0P1P2P3Gr', { p0: i ? ' · ' : '', p1: m.metal, p2: purityText(m.purity), p3: $weight(m.fineGrams, 3) }) }}</template>
          </span>
        </div>
        <div class="table-scroll-wrap">
          <table class="jp-enterprise-table">
            <thead><tr><th class="text-right" style="width: 130px;">{{ $t('finance.tarih') }}</th><th>{{ $t('common.item') }}</th><th>{{ $t('finance.hareket') }}</th><th class="text-right">{{ $t('common.quantity') }}</th><th class="text-right">{{ $t('finance.hasGr') }}</th><th class="text-right">{{ $t('finance.maliyet') }}</th><th class="text-right">{{ $t('finance.sonrakiBakiye') }}</th><th>{{ $t('finance.referans') }}</th><th>{{ $t('finance.kullanici') }}</th></tr></thead>
            <tbody>
              <tr v-for="m in movements" :key="m._id">
                <td class="text-right tabular text-caption text-disabled">{{ formatDate(m.createdAt) }}</td>
                <td>{{ m.itemType === 'metal' ? `${m.metal} ${purityText(m.purity)}` : (m.productName || `#${m.productId}`) }}</td>
                <td><span class="jp-badge" :class="(m.quantity > 0 || m.fineMg > 0) ? 'jp-badge-success' : (m.quantity < 0 || m.fineMg < 0 ? 'jp-badge-danger' : 'jp-badge-neutral')">{{ movementLabel(m.movementType) }}</span></td>
                <td class="text-right tabular">{{ m.itemType === 'product' ? m.quantity : '—' }}</td>
                <td class="text-right tabular">{{ m.itemType === 'metal' ? $weight(m.fineGrams, 3) : '—' }}</td>
                <td class="text-right tabular">{{ m.cost === null ? 'bilinmiyor' : money(m.cost) }}</td>
                <td class="text-right tabular">{{ m.balanceAfter ?? '—' }}</td>
                <td class="text-caption">{{ m.reference ? `${m.reference.kind} #${m.reference.id}` : '—' }}</td>
                <td class="text-caption">{{ m.createdBy?.name || 'sistem' }}</td>
              </tr>
              <tr v-if="!loading && !movements.length"><td colspan="9" class="empty-table-state">{{ $t('finance.henuzStokHareketiYok') }}</td></tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- RECONCILIATION -->
      <template v-if="activeTab === 'books'">
        <div class="books-grid">
          <div class="pa-2 rounded books-box">
            <div class="d-flex align-center justify-space-between">
              <strong>{{ $t('finance.defterMutabakati') }}</strong>
              <span v-if="reconciliation" class="jp-badge" :class="reconciliation.ok ? 'jp-badge-success' : 'jp-badge-danger'">{{ reconciliation.ok ? $t('finance.mutabik') : $t('finance.farkVar') }}</span>
            </div>
            <div v-if="reconciliation" class="text-caption text-disabled mt-1">
              {{ $t('finance.p0KayitP1HesapP2', { p0: reconciliation.ledger.entriesChecked, p1: reconciliation.ledger.accountsChecked, p2: reconciliation.ledger.customersChecked, p3: reconciliation.inventory.productsChecked }) }}
            </div>
            <ul v-if="reconciliation && !reconciliation.ok" class="text-caption mt-2 discrepancy-list">
              <li v-for="(d, i) in allDiscrepancies" :key="i">{{ discrepancyText(d) }}</li>
            </ul>
          </div>
          <div class="pa-2 rounded books-box">
            <strong>{{ $t('finance.stokDegerlemesi') }}</strong>
            <template v-if="valuation">
              <div class="text-caption mt-1">{{ $t('finance.urunlerMaliyet') }} <strong class="tabular">{{ money(valuation.products.costValueTry) }}</strong> {{ $t('finance.p0Adet', { p0: valuation.products.pieces }) }}</div>
              <div v-if="valuation.products.unknownCostItems" class="text-caption text-warning">{{ $t('finance.p0UrundeMaliyetBilinmiyorP1', { p0: valuation.products.unknownCostItems, p1: valuation.products.unknownCostUnits }) }}</div>
              <div class="text-caption">{{ $t('finance.madenStoguMaliyet') }} <strong class="tabular">{{ money(valuation.metalPools.costValueTry) }}</strong></div>
              <div class="text-caption">
                {{ $t('finance.hasAltinPiyasaDegeri') }}
                <strong v-if="valuation.metalPools.market.XAU.valueTry !== null" class="tabular">{{ money(valuation.metalPools.market.XAU.valueTry) }}</strong>
                <span v-else class="text-disabled">{{ valuation.metalPools.market.XAU.priceUnavailableReason }}</span>
              </div>
            </template>
          </div>
        </div>
        <div class="table-scroll-wrap mt-2">
          <table class="jp-enterprise-table">
            <thead><tr><th>{{ $t('common.account') }}</th><th>{{ $t('finance.birim') }}</th><th class="text-right">{{ $t('finance.borc') }}</th><th class="text-right">{{ $t('finance.alacak') }}</th><th class="text-right">{{ $t('finance.bakiye') }}</th></tr></thead>
            <tbody>
              <tr v-for="a in accounts" :key="`${a.account}|${a.unit}`">
                <td class="tabular">{{ accountLabel(a.account) }}</td>
                <td>{{ a.unit === 'TRY' ? 'TL' : `${a.unit} (gr has)` }}</td>
                <td class="text-right tabular">{{ amount(a, a.debit) }}</td>
                <td class="text-right tabular">{{ amount(a, a.credit) }}</td>
                <td class="text-right tabular font-weight-bold">{{ amount(a, a.balance) }}</td>
              </tr>
              <tr v-if="!loading && !accounts.length"><td colspan="5" class="empty-table-state">{{ $t('finance.henuzMuhasebeKaydiYok') }}</td></tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

    <!-- NEW SUPPLIER -->
    <v-dialog v-model="supplierDialog" max-width="480px" persistent>
      <v-card class="pa-2">
        <v-card-title class="dialog-header"><v-icon size="18" color="primary" class="mr-2">mdi-truck-outline</v-icon>{{ $t('finance.tedarikciEkle') }}</v-card-title>
        <v-card-text>
          <div class="form-row"><label class="form-label" for="financepage-f1">{{ $t('finance.unvan') }}</label><input id="financepage-f1" v-model.trim="supplierForm.name" type="text" maxlength="160" class="form-input-full" /></div>
          <div class="form-grid-2 mt-3">
            <div><label class="form-label" for="financepage-f2">{{ $t('finance.telefon2') }}</label><input id="financepage-f2" v-model.trim="supplierForm.phone" type="text" class="form-input-full" /></div>
            <div><label class="form-label" for="financepage-f3">{{ $t('finance.ePosta') }}</label><input id="financepage-f3" v-model.trim="supplierForm.email" type="email" class="form-input-full" /></div>
          </div>
          <div class="form-grid-2 mt-3">
            <div><label class="form-label" for="financepage-f4">{{ $t('finance.vergiNo2') }}</label><input id="financepage-f4" v-model.trim="supplierForm.taxNumber" type="text" class="form-input-full" /></div>
            <div><label class="form-label" for="financepage-f5">{{ $t('finance.vergiDairesi') }}</label><input id="financepage-f5" v-model.trim="supplierForm.taxOffice" type="text" class="form-input-full" /></div>
          </div>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" @click="supplierDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn size="small" class="jp-primary" :loading="saving" :disabled="!supplierForm.name" @click="saveSupplier">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- PAYMENT (purchase / supplier account) -->
    <v-dialog v-model="paymentDialog" max-width="420px" persistent>
      <v-card class="pa-2">
        <v-card-title class="dialog-header"><v-icon size="18" color="success" class="mr-2">mdi-cash-minus</v-icon>{{ $t(paymentForm.titleKey, paymentForm.titleParams) }}</v-card-title>
        <v-card-text>
          <div class="text-caption text-disabled mb-2">{{ $t('finance.kalanBorc') }} <strong class="tabular">{{ money(paymentForm.max) }}</strong></div>
          <div class="form-grid-2">
            <div>
              <label class="form-label" for="financepage-f10">{{ $t('finance.odemeYontemi') }}</label>
              <select id="financepage-f10" v-model="paymentForm.method" class="form-select-full">
                <option value="havale">{{ $t('finance.havaleEft') }}</option>
                <option value="nakit">{{ $t('finance.nakit') }}</option>
                <option value="kredi kartı">{{ $t('finance.krediKarti') }}</option>
              </select>
            </div>
            <div><label class="form-label" for="financepage-f11">{{ $t('finance.tutarTl') }}</label><input id="financepage-f11" v-model.trim="paymentForm.amount" type="text" inputmode="decimal" class="form-input-full tabular" /></div>
          </div>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" :disabled="saving" @click="paymentDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn size="small" class="jp-primary" :loading="saving" :disabled="!isValidAmount(paymentForm.amount)" @click="submitPayment">{{ $t('finance.ode') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <PurchaseDialog v-model="purchaseDialog" :suppliers="suppliers" :products="products" @saved="onPurchaseSaved" />
    <PurchaseReturnDialog v-model="returnDialog" :purchase="returnTarget" @saved="loadTab" />

    <!-- SUPPLIER STATEMENT -->
    <v-dialog v-model="statementDialog" max-width="720px">
      <v-card class="pa-2">
        <v-card-title class="dialog-header"><v-icon size="18" color="info" class="mr-2">mdi-file-document-outline</v-icon>{{ $t('finance.tedarikciEkstresiP0', { p0: statement?.supplier?.name }) }}</v-card-title>
        <v-card-text>
          <div class="text-caption mb-2">{{ $t('finance.bakiyeBorcumuz2') }} <strong class="tabular">{{ money(statement?.balanceTry || 0) }}</strong></div>
          <div class="table-scroll-wrap" style="max-height: 360px;">
            <table class="jp-enterprise-table">
              <thead><tr><th>{{ $t('finance.tarih') }}</th><th>{{ $t('finance.aciklama') }}</th><th class="text-right">{{ $t('finance.borc') }}</th><th class="text-right">{{ $t('finance.alacak') }}</th><th class="text-right">{{ $t('finance.bakiye') }}</th></tr></thead>
              <tbody>
                <tr v-for="e in statement?.entries || []" :key="e.id">
                  <td class="tabular text-caption">{{ formatDate(e.date) }}</td>
                  <td :title="e.title">{{ $ledger(e) }}</td>
                  <td class="text-right tabular">{{ e.direction === 'borc' ? money(e.amountTry) : '' }}</td>
                  <td class="text-right tabular">{{ e.direction === 'alacak' ? money(e.amountTry) : '' }}</td>
                  <td class="text-right tabular">{{ money(e.balanceAfterTry) }}</td>
                </tr>
                <tr v-if="!(statement?.entries || []).length"><td colspan="5" class="empty-table-state">{{ $t('finance.hareketYok') }}</td></tr>
              </tbody>
            </table>
          </div>
        </v-card-text>
        <v-card-actions class="dialog-actions"><v-spacer></v-spacer><v-btn size="small" class="jp-secondary" @click="statementDialog = false">{{ $t('common.close') }}</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { dateTime, t } from '@/i18n';
import apiService from '@/services/api';
import { hasPermission } from '@/services/authSession';
import {
  normalizeDecimalInput, isValidAmount, newIdempotencyKey, formatTry, formatGrams, purityLabel, errorMessage,
  translatedLabels,
} from '@/services/finance';
import { confirmAction } from '@/services/confirm';
import PurchaseDialog from '@/components/finance/PurchaseDialog.vue';
import PurchaseReturnDialog from '@/components/finance/PurchaseReturnDialog.vue';

// Translated on every read (not at import), so labels follow language changes.
const MOVEMENT_LABELS = translatedLabels('finance.movement');

export default {
  name: 'FinancePage',
  components: { PurchaseDialog, PurchaseReturnDialog },
  data() {
    return {
      activeTab: 'suppliers',
      loading: false,
      saving: false,
      loadError: '',
      suppliers: [],
      purchases: [],
      products: [],
      movements: [],
      metalPools: [],
      accounts: [],
      reconciliation: null,
      valuation: null,
      supplierDialog: false,
      supplierForm: {},
      purchaseDialog: false,
      paymentDialog: false,
      paymentForm: { titleKey: 'finance.odeme', titleParams: {}, max: 0, method: 'havale', amount: '', target: null, key: '' },
      statementDialog: false,
      statement: null,
      returnDialog: false,
      returnTarget: null,
    };
  },
  computed: {
    visibleTabs() {
      return [
        { id: 'suppliers', label: t('finance.tedarikciler'), icon: 'mdi-truck-outline', permission: 'purchases:read' },
        { id: 'purchases', label: t('finance.alislar'), icon: 'mdi-package-variant', permission: 'purchases:read' },
        { id: 'inventory', label: t('finance.stokHareketleri'), icon: 'mdi-swap-vertical', permission: 'catalog:read' },
        { id: 'books', label: t('finance.muhasebeMutabakat'), icon: 'mdi-scale-balance', permission: 'ledger:read' },
      ].filter((t) => hasPermission(t.permission));
    },
    totalPayable() {
      return this.suppliers.reduce((s, x) => s + (x.balanceTry > 0 ? x.balanceTry : 0), 0);
    },
    openPurchases() {
      return this.purchases.filter((p) => p.status !== 'cancelled').reduce((s, p) => s + p.remaining, 0);
    },
    allDiscrepancies() {
      if (!this.reconciliation) return [];
      return [
        ...this.reconciliation.ledger.discrepancies,
        ...this.reconciliation.inventory.discrepancies,
        ...(this.reconciliation.transfers?.discrepancies || []),
        ...(this.reconciliation.pos?.discrepancies || []),
      ];
    },
  },
  mounted() {
    this.loadTab();
  },
  methods: {
    isValidAmount,
    money: formatTry,
    purityText: purityLabel,
    movementLabel: (type) => MOVEMENT_LABELS[type] || type,
    selectTab(id) {
      this.activeTab = id;
      this.loadTab();
    },
    async loadTab() {
      this.loading = true;
      this.loadError = '';
      try {
        if (this.activeTab === 'suppliers' || this.activeTab === 'purchases') {
          const [suppliers, purchases, products] = await Promise.all([
            apiService.get('/api/suppliers'),
            apiService.get('/api/purchases'),
            apiService.get('/api/products'),
          ]);
          this.suppliers = suppliers || [];
          this.purchases = purchases || [];
          this.products = (products || []).filter((p) => !p.isArchived);
        } else if (this.activeTab === 'inventory') {
          const [movements, pools] = await Promise.all([apiService.get('/api/inventory/movements?limit=200'), apiService.get('/api/inventory/metal')]);
          this.movements = movements || [];
          this.metalPools = (pools || []).filter((p) => p.fineGrams > 0);
        } else if (this.activeTab === 'books') {
          const [reconciliation, valuation, accounts] = await Promise.all([
            apiService.get('/api/ledger/reconciliation'),
            apiService.get('/api/inventory/valuation'),
            apiService.get('/api/ledger/accounts'),
          ]);
          this.reconciliation = reconciliation;
          this.valuation = valuation;
          this.accounts = (accounts || []).filter((a) => a.debit || a.credit);
        }
      } catch (err) {
        this.loadError = t('finance.verilerYuklenemediP0', { p0: errorMessage(err) });
      } finally {
        this.loading = false;
      }
    },
    openSupplierDialog() {
      this.supplierForm = { name: '', phone: '', email: '', taxNumber: '', taxOffice: '' };
      this.supplierDialog = true;
    },
    async saveSupplier() {
      this.saving = true;
      try {
        await apiService.post('/api/suppliers', this.supplierForm);
        this.supplierDialog = false;
        this.$store.dispatch('notifications/showSuccess', t('finance.tedarikciKaydedildi'));
        await this.loadTab();
      } catch (err) {
        this.$store.dispatch('notifications/showError', errorMessage(err));
      } finally {
        this.saving = false;
      }
    },
    openPurchaseDialog() {
      this.purchaseDialog = true;
    },
    async onPurchaseSaved() {
      this.activeTab = 'purchases';
      await this.loadTab();
    },
    openPurchasePayment(p) {
      this.paymentForm = { titleKey: 'finance.alisP0Odemesi', titleParams: { p0: p._id }, max: p.remaining, method: 'havale', amount: p.remaining.toFixed(2), target: { kind: 'purchase', id: p._id }, key: newIdempotencyKey('ppay') };
      this.paymentDialog = true;
    },
    openSupplierPayment(s) {
      this.paymentForm = { titleKey: 'finance.p0CariOdeme', titleParams: { p0: s.name }, max: s.balanceTry, method: 'havale', amount: s.balanceTry.toFixed(2), target: { kind: 'supplier', id: s._id }, key: newIdempotencyKey('spay') };
      this.paymentDialog = true;
    },
    async submitPayment() {
      const f = this.paymentForm;
      const amount = normalizeDecimalInput(f.amount);
      this.saving = true;
      try {
        if (f.target.kind === 'purchase') {
          await apiService.post(`/api/purchases/${f.target.id}/payments`, { method: f.method, amount }, { headers: { 'Idempotency-Key': f.key } });
        } else if (f.target.kind === 'refund') {
          await apiService.post(`/api/purchases/${f.target.id}/refunds`, { method: f.method, amount }, { headers: { 'Idempotency-Key': f.key } });
        } else {
          await apiService.post('/api/cash/transactions', { type: 'tediye', supplierId: f.target.id, paymentMethod: f.method, amountTry: amount }, { headers: { 'Idempotency-Key': f.key } });
        }
        this.paymentDialog = false;
        this.$store.dispatch('notifications/showSuccess', t('finance.odemeKaydedildi'));
        await this.loadTab();
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('finance.odemeKaydedilemediP0', { p0: errorMessage(err) }));
      } finally {
        this.saving = false;
      }
    },
    async cancelPurchase(p) {
      const ok = await confirmAction({
        title: t('finance.cancelPurchaseTitle'),
        message: t('finance.cancelPurchaseConfirm', { id: p._id }),
        confirmLabel: t('finance.cancelPurchaseTitle'),
        tone: 'danger',
      });
      if (!ok) return;
      try {
        await apiService.delete(`/api/purchases/${p._id}`);
        this.$store.dispatch('notifications/showSuccess', t('finance.alisIptalEdildi'));
        await this.loadTab();
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('finance.iptalEdilemediP0', { p0: errorMessage(err) }));
      }
    },
    async openStatement(s) {
      this.statement = null;
      this.statementDialog = true;
      try {
        this.statement = await apiService.get(`/api/suppliers/${s._id}/statement`);
      } catch (err) {
        this.statementDialog = false;
        this.$store.dispatch('notifications/showError', errorMessage(err));
      }
    },
    purchaseStatus(p) {
      if (p.status === 'cancelled') return t('status.sale.cancelled');
      const pay = { paid: t('finance.odendi'), partial: t('finance.kismiOdeme'), unpaid: t('finance.acik'), overpaid: t('finance.overpaid') }[p.paymentStatus] || p.paymentStatus;
      if (p.returnStatus === 'full') return t('finance.returnFull', { status: pay });
      if (p.returnStatus === 'partial') return t('finance.returnPartial', { status: pay });
      return pay;
    },
    openReturn(p) {
      this.returnTarget = p;
      this.returnDialog = true;
    },
    openRefund(p) {
      this.paymentForm = { titleKey: 'finance.alisP0TedarikciGeriOdemesi', titleParams: { p0: p._id }, max: p.supplierCredit, method: 'havale', amount: p.supplierCredit.toFixed(2), target: { kind: 'refund', id: p._id }, key: newIdempotencyKey('prefund') };
      this.paymentDialog = true;
    },
    purchaseBadge(p) {
      if (p.status === 'cancelled') return 'jp-badge-danger';
      return p.paymentStatus === 'paid' ? 'jp-badge-success' : 'jp-badge-warning';
    },
    accountLabel(code) {
      const [kind, ...rest] = code.split(':');
      const tail = rest.join(':');
      const names = {
        cash: t('finance.accCash'), bank: t('finance.accBank'), vault: t('finance.altinKasasi'), ar: t('finance.musteriCari'), ap: t('finance.tedarikciCari'), inventory: t('finance.accInventory'),
        revenue: t('finance.accRevenue'), cogs: t('finance.satilanMalinMaliyeti'), expense: t('finance.accExpense'), equity: t('finance.ozkaynak'), inventory_adjustment: t('finance.sayimFarki'), cash_over_short: t('finance.kasaFarki'), gold_over_short: t('finance.altinKasasiSayimFarki'),
      };
      return `${names[kind] || kind}${tail ? ` · ${tail}` : ''}`;
    },
    amount(account, value) {
      return account.unit === 'TRY' ? formatTry(value) : formatGrams(value);
    },
    discrepancyText(d) {
      const labels = {
        entry_balanced: t('finance.dengesizKayit'), account_projection: t('finance.hesapBakiyesiDefterleUyusmuyor'), customer_balance: t('finance.musteriBakiyesiDefterleUyusmuyor'),
        supplier_balance: t('finance.tedarikciBakiyesiDefterleUyusmuyor'), trial_balance: t('finance.mizanSifirlanmiyor'), missing_opening: t('finance.acilisStokHareketiEksik'),
        product_quantity: t('finance.urunStoguHareketlerleUyusmuyor'), product_cost_pool: t('finance.urunMaliyetiHareketlerleUyusmuyor'), metal_pool: t('finance.madenStoguHareketlerleUyusmuyor'), negative_stock: t('finance.negatifStok'),
      };
      const subject = d.account || (d.customerId && `${t('common.customer')} #${d.customerId}`) || (d.supplierId && `${t('common.supplier')} #${d.supplierId}`) || (d.productId && `${d.name || t('common.product')} #${d.productId}`) || d.pool || d.unit || '';
      return `${labels[d.check] || d.check}: ${subject}`;
    },
    formatDate(value) {
      return dateTime(value);
    },
  },
};
</script>

<style scoped src="@/styles/finance-form.css"></style>

<style scoped>
.finance-page-shell {
  height: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  gap: 8px;
}
.header-actions { display: flex; align-items: center; gap: 8px; }
.finance-tabs { display: flex; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
.finance-tab {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  color: var(--jp-text-subtle);
  font-size: 11px;
  cursor: pointer;
}
.finance-tab.active { color: var(--jp-gold); border-color: var(--jp-gold-border); background: var(--jp-gold-subtle); }
.finance-card { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; padding: 8px 12px; }
.finance-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--jp-border); flex-shrink: 0; flex-wrap: wrap; }
.finance-error { color: var(--jp-danger); font-size: 11px; padding: 4px 0; }
.record-counter { font-size: 11px; color: var(--jp-text-subtle); }
.table-scroll-wrap { flex: 1; min-height: 0; overflow: auto; }
.empty-table-state { text-align: center; padding: 24px 0 !important; color: var(--jp-text-subtle); font-size: 12px; }
.row-cancelled td { opacity: 0.55; }
.text-warning { color: var(--jp-warning); }
.books-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex-shrink: 0; }
.books-box { background: var(--jp-surface-muted); border: 1px solid var(--jp-border); font-size: 12px; }
.discrepancy-list { max-height: 120px; overflow: auto; color: var(--jp-danger); padding-left: 16px; }
.text-success { color: var(--jp-success, var(--jp-success)); }
@media (max-width: 720px) {
  .books-grid { grid-template-columns: 1fr; }
}
</style>
