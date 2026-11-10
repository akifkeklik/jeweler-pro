<template>
  <v-dialog v-model="open" max-width="760px" persistent>
    <v-card class="pa-2">
      <v-card-title class="dialog-header">
        <v-icon size="18" color="primary" class="mr-2">mdi-lightning-bolt</v-icon>
        {{ $t('sales.dialogNew') }}
      </v-card-title>
      <v-card-text>
        <div class="form-row">
          <label class="form-label" for="sale-customer">{{ $t('sales.customerRequired') }} *</label>
          <select id="sale-customer" v-model="cart.customerId" class="form-select-full" data-test="sale-customer">
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
          <div v-for="(line, index) in cart.lines" :key="line.key" class="cart-row">
            <select v-model="line.productId" class="form-select-full" :data-test="`sale-product-${index}`" :aria-label="$t('common.product')">
              <option value="" disabled>{{ $t('sales.selectProduct') }}</option>
              <option v-for="p in products" :key="p._id" :value="p._id" :disabled="p.stock <= 0">
                {{ productLabel(p) }} ({{ $t('sales.stockShort', { count: $n(p.stock) }) }})
              </option>
            </select>
            <input v-model.number="line.quantity" type="number" min="1" class="form-input-full tabular text-right" :aria-label="$t('common.quantity')" />
            <input v-model.trim="line.discountPercent" type="text" inputmode="decimal" placeholder="0" class="form-input-full tabular text-right" :aria-label="$t('sales.col.discountPct')" />
            <span class="tabular text-right cart-amount">{{ quoteLine(index) ? money(quoteLine(index)?.unitPrice) : '—' }}</span>
            <span class="tabular text-right cart-amount font-weight-bold">{{ quoteLine(index) ? money(quoteLine(index)?.total) : '—' }}</span>
            <v-btn icon size="x-small" variant="text" color="error" :disabled="cart.lines.length === 1" :aria-label="$t('sales.removeLine')" @click="cart.lines.splice(index, 1)">
              <v-icon size="15">mdi-close</v-icon>
            </v-btn>
          </div>
          <v-btn size="x-small" variant="text" color="primary" class="mt-1" @click="cart.lines.push(newLine())">
            <v-icon start size="14">mdi-plus</v-icon> {{ $t('sales.addLine') }}
          </v-btn>
        </div>

        <!-- One manual price per metal in the cart; each gram line is priced with ITS metal. -->
        <div v-for="metal in gramMetals" :key="metal" class="form-grid-2 mt-3">
          <div>
            <label class="form-label" :for="`sale-manual-price-${metal}`">{{ $t(metal === 'XAG' ? 'sales.manualSilver' : 'sales.manualGold') }}</label>
            <input :id="`sale-manual-price-${metal}`" v-model.trim="cart.manualPrices[metal]" type="text" inputmode="decimal" :placeholder="$t('sales.manualGoldPlaceholder')" class="form-input-full tabular" />
          </div>
          <div class="price-source-note">
            <template v-if="metalPriceInfo[metal]">
              {{ $t('sales.priceInfo', { price: $n(metalPriceInfo[metal]?.pricePerGram), source: metalPriceInfo[metal]?.priceType === 'manual' ? $t('sales.priceManual') : `${$t('sales.priceLive')} · ${metalPriceInfo[metal]?.source}` }) }}
            </template>
          </div>
        </div>

        <div class="form-grid-2 mt-3">
          <div>
            <label class="form-label" for="sale-discount">{{ $t('sales.saleDiscount') }}</label>
            <input id="sale-discount" v-model.trim="cart.saleDiscount" type="text" inputmode="decimal" placeholder="0.00" class="form-input-full tabular" />
          </div>
          <div>
            <label class="form-label" for="sale-notes">{{ $t('common.note') }}</label>
            <input id="sale-notes" v-model.trim="cart.notes" type="text" maxlength="200" class="form-input-full" />
          </div>
        </div>

        <div class="payments-block mt-3">
          <div class="d-flex align-center justify-space-between mb-1">
            <span class="form-label mb-0">{{ $t('sales.paymentsLabel') }}</span>
            <v-btn size="x-small" variant="text" color="success" :disabled="!quote" @click="payInFull">{{ $t('sales.payInFull') }}</v-btn>
          </div>
          <div v-for="(payment, index) in cart.payments" :key="payment.key" class="payment-row">
            <select v-model="payment.method" class="form-select-full" :aria-label="$t('sales.paymentMethod')">
              <option value="nakit">{{ $t('payment.cash') }}</option>
              <option value="kredi kartı">{{ $t('payment.card') }}</option>
              <option value="havale">{{ $t('payment.transfer') }}</option>
            </select>
            <input v-model.trim="payment.amount" type="text" inputmode="decimal" placeholder="0.00" class="form-input-full tabular text-right" :aria-label="$t('common.amount')" />
            <v-btn icon size="x-small" variant="text" color="error" :aria-label="$t('sales.removePayment')" @click="cart.payments.splice(index, 1)">
              <v-icon size="15">mdi-close</v-icon>
            </v-btn>
            <div v-if="payment.method === 'kredi kartı' && providers.length" class="pos-row">
              <select v-model="payment.providerId" class="form-select-full" aria-label="POS">
                <option value="" disabled>{{ $t('sales.selectPos') }}</option>
                <option v-for="pp in providers" :key="pp._id" :value="pp._id">{{ pp.name }}</option>
              </select>
              <select v-model.number="payment.installments" class="form-select-full" :aria-label="$t('sales.installmentLabel')">
                <option v-for="count in installmentsFor(payment.providerId)" :key="count" :value="count">{{ installmentText(count) }}</option>
              </select>
            </div>
          </div>
          <v-btn size="x-small" variant="text" color="primary" :disabled="cart.payments.length >= 4" @click="cart.payments.push(newPayment())">
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
        <v-btn size="small" class="jp-secondary" :disabled="saving" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn size="small" class="jp-primary" :loading="saving" :disabled="!canSubmit" data-test="sale-submit" @click="submit">
          <v-icon start size="14">mdi-check</v-icon>
          {{ $t('sales.complete') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import apiService from '@/services/api';
import {
  crossBranchTarget, errorMessage, formatGrams, formatTry, newIdempotencyKey, normalizeDecimalInput, purityLabel,
} from '@/services/finance';
import { confirmAction } from '@/services/confirm';
import { posBlock } from '@/services/operations';
import { gramMetalsOf, manualPricesPayload, quotedMetalPrices, type MetalCode, type QuotedPrice } from '@/services/salePricing';
import { addScannedProduct, resolveScan } from '@/services/barcode';
import { defaultProviderId, installmentsOf, loadActivePosProviders, type PosProviderOption } from '@/services/posProviders';
import { installmentText } from '@/services/saleView';
import { t } from '@/i18n';

export interface CartProduct {
  _id: number;
  name: string;
  stock: number;
  price?: number;
  pricingMode?: 'fixed' | 'gram';
  weight?: number;
  purity?: number;
  metal?: string;
  barcode?: string | null;
  sku?: string | null;
  isArchived?: boolean;
}

export interface CartCustomer { _id: number; name: string; phone?: string }

interface CartLine { key: string; productId: number | ''; quantity: number; discountPercent: string }
interface CartPayment { key: string; method: string; amount: string; providerId: string; installments: number }
interface Cart {
  customerId: number | '';
  lines: CartLine[];
  payments: CartPayment[];
  saleDiscount: string;
  manualPrices: Record<string, string>;
  notes: string;
}
interface QuoteLine { unitPrice: number; total: number; pricingMode?: string; metal?: string; price?: QuotedPrice }
interface Quote { lines: QuoteLine[]; subtotal: number; discount: number; total: number; paid: number; balanceDue: number }
interface SalePayload {
  customerId: number;
  lines: Array<{ productId: number; quantity: number; discount?: { type: 'percent'; value: string } }>;
  payments: Array<{ method: string; amount: string; pos?: ReturnType<typeof posBlock> }>;
  discount?: { type: 'amount'; value: string };
  manualPrices?: Record<string, string>;
  notes?: string;
}

let seq = 0;
const newLine = (): CartLine => ({ key: `l${(seq += 1)}`, productId: '', quantity: 1, discountPercent: '' });
const newPayment = (method = 'nakit'): CartPayment => ({ key: `p${(seq += 1)}`, method, amount: '', providerId: '', installments: 1 });
const emptyCart = (customerId: number | '' = ''): Cart => ({
  customerId, lines: [newLine()], payments: [newPayment()], saleDiscount: '', manualPrices: { XAU: '', XAG: '' }, notes: '',
});

/**
 * POS cart. Prices are always quoted by the server (POST /api/sales/quote) —
 * the client never computes an amount. A sale is submitted once per dialog
 * (Idempotency-Key); an admin selling another branch's stock must confirm it.
 */
export default defineComponent({
  name: 'NewSaleDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    customers: { type: Array as PropType<CartCustomer[]>, default: () => [] },
    products: { type: Array as PropType<CartProduct[]>, default: () => [] },
    initialCustomerId: { type: [Number, String] as PropType<number | ''>, default: '' },
  },
  emits: ['update:modelValue', 'saved'],
  data: () => ({
    cart: emptyCart(),
    scanCode: '',
    saleKey: '',
    providers: [] as PosProviderOption[],
    quote: null as Quote | null,
    quoting: false,
    quoteError: '',
    quoteTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    quoteSeq: 0,
    saving: false,
  }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
    gramMetals(): MetalCode[] {
      return gramMetalsOf(this.cart.lines, (id: unknown) => this.productById(id));
    },
    metalPriceInfo(): Partial<Record<string, QuotedPrice>> {
      return quotedMetalPrices(this.quote?.lines);
    },
    payload(): SalePayload {
      const payload: SalePayload = {
        customerId: Number(this.cart.customerId),
        lines: this.cart.lines.filter((l) => l.productId).map((l) => {
          const discount = normalizeDecimalInput(l.discountPercent);
          return { productId: Number(l.productId), quantity: Number(l.quantity) || 1, ...(discount ? { discount: { type: 'percent' as const, value: discount } } : {}) };
        }),
        payments: this.cart.payments.filter((p) => normalizeDecimalInput(p.amount)).map((p) => {
          const pos = posBlock(p.method, p.providerId || defaultProviderId(this.providers), p.installments);
          return { method: p.method, amount: normalizeDecimalInput(p.amount), ...(pos ? { pos } : {}) };
        }),
      };
      const saleDiscount = normalizeDecimalInput(this.cart.saleDiscount);
      if (saleDiscount) payload.discount = { type: 'amount', value: saleDiscount };
      const manualPrices = manualPricesPayload(this.gramMetals, this.cart.manualPrices);
      if (manualPrices) payload.manualPrices = manualPrices;
      if (this.cart.notes) payload.notes = this.cart.notes;
      return payload;
    },
    canSubmit(): boolean {
      return Boolean(this.cart.customerId) && this.payload.lines.length > 0 && Boolean(this.quote) && !this.quoteError && !this.quoting;
    },
  },
  watch: {
    payload: {
      deep: true,
      handler() {
        if (this.modelValue) this.scheduleQuote();
      },
    },
    async modelValue(value: boolean) {
      if (!value) {
        clearTimeout(this.quoteTimer);
        return;
      }
      const preset = this.initialCustomerId && this.customers.some((c) => c._id === Number(this.initialCustomerId)) ? Number(this.initialCustomerId) : '';
      this.cart = emptyCart(preset);
      this.quote = null;
      this.quoteError = '';
      // One key per sale attempt: a retried submit of the same cart is applied once.
      this.saleKey = newIdempotencyKey('sale');
      // The dialog renders lazily; focus the scan field once it is in the DOM.
      setTimeout(() => (this.$refs.scanInput as HTMLInputElement | undefined)?.focus(), 150);
      this.providers = await loadActivePosProviders();
    },
  },
  beforeUnmount() {
    clearTimeout(this.quoteTimer);
  },
  methods: {
    money: formatTry,
    installmentText,
    newLine,
    newPayment,
    productLabel(p: CartProduct): string {
      return p.pricingMode === 'gram'
        ? `${p.name} — ${formatGrams(p.weight)} ${purityLabel(p.purity)}`
        : `${p.name} — ${formatTry(p.price)}`;
    },
    productById(id: unknown): CartProduct | undefined {
      return this.products.find((p) => p._id === Number(id));
    },
    installmentsFor(providerId: string): number[] {
      return installmentsOf(this.providers, providerId);
    },
    quoteLine(index: number): QuoteLine | null {
      if (!this.quote || !this.cart.lines[index]?.productId) return null;
      const position = this.cart.lines.slice(0, index + 1).filter((l) => l.productId).length - 1;
      return this.quote.lines[position] || null;
    },
    /** Barcode scan (keyboard wedge): adds one unit of the scanned product. */
    onScan() {
      const result = resolveScan(this.products, this.scanCode);
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
      const { capped } = addScannedProduct(this.cart.lines, result.product, newLine);
      if (capped) this.$store.dispatch('notifications/showWarning', t('sales.scanCapped', { name: result.product.name }));
      this.$nextTick(() => (this.$refs.scanInput as HTMLInputElement | undefined)?.focus());
    },
    payInFull() {
      if (!this.quote) return;
      const method = this.cart.payments[0]?.method || 'nakit';
      const payment = newPayment(method);
      payment.amount = this.quote.total.toFixed(2);
      this.cart.payments = [payment];
    },
    scheduleQuote() {
      clearTimeout(this.quoteTimer);
      this.quoteError = '';
      if (!this.cart.customerId || !this.payload.lines.length) {
        this.quote = null;
        return;
      }
      this.quoteTimer = setTimeout(() => this.fetchQuote(), 300);
    },
    async fetchQuote() {
      const current = (this.quoteSeq += 1);
      this.quoting = true;
      try {
        const quote = await apiService.post<Quote>('/api/sales/quote', this.payload);
        if (current !== this.quoteSeq) return;
        this.quote = quote;
        this.quoteError = '';
      } catch (err) {
        if (current !== this.quoteSeq) return;
        this.quote = null;
        this.quoteError = (err as { code?: string })?.code === 'MARKET_PRICE_UNAVAILABLE' ? t('sales.livePriceUnavailable') : errorMessage(err);
      } finally {
        if (current === this.quoteSeq) this.quoting = false;
      }
    },
    async submit() {
      if (!this.canSubmit) return;
      this.saving = true;
      const headers = { 'Idempotency-Key': this.saleKey };
      try {
        try {
          await apiService.post('/api/sales', this.payload, { headers });
        } catch (err) {
          // Admin selling another branch's stock: the branch must be confirmed explicitly.
          const branch = crossBranchTarget(err);
          if (!branch || !(await confirmAction({
            message: t('sales.crossBranch', { branch }),
            confirmLabel: t('sales.crossBranchConfirm', { branch }),
            tone: 'warning',
          }))) throw err;
          await apiService.post('/api/sales', { ...this.payload, branch }, { headers });
        }
        this.$store.dispatch('notifications/showSuccess', t('sales.saved'));
        this.open = false;
        this.$emit('saved');
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('sales.saveFailed', { reason: errorMessage(err) }));
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped src="./sale-dialog.css"></style>

<style scoped>
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
.quote-error {
  color: var(--jp-danger);
  font-size: 11px;
}
@media (max-width: 720px) {
  .cart-head { display: none; }
  .cart-row { grid-template-columns: 1fr 56px 56px; }
  .cart-row .cart-amount { display: none; }
  .payment-row { grid-template-columns: 1fr 110px 28px; }
}
</style>
