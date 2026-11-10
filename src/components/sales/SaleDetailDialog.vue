<template>
  <v-dialog v-model="open" max-width="640px">
    <v-card class="pa-2">
      <v-card-title class="dialog-header">
        <v-icon size="18" color="info" class="mr-2">mdi-receipt-text</v-icon>
        {{ $t('sales.receiptTitle', { id: sale?._id }) }}
      </v-card-title>
      <v-card-text v-if="sale">
        <div class="receipt-grid">
          <div class="receipt-row"><span class="label">{{ $t('common.customer') }}</span><strong class="val">{{ sale.customerName || '—' }}</strong></div>
          <div class="receipt-row"><span class="label">{{ $t('common.date') }}</span><span class="val tabular">{{ formatDate(sale.date) }}</span></div>
          <div class="receipt-row"><span class="label">{{ $t('common.status') }}</span><span class="jp-badge" :class="statusBadge(sale)">{{ statusLabel(sale) }}</span></div>
        </div>
        <table v-if="sale.lines && sale.lines.length" class="jp-enterprise-table mt-3">
          <thead>
            <tr><th>{{ $t('common.product') }}</th><th class="text-right">{{ $t('common.quantity') }}</th><th class="text-right">{{ $t('sales.col.unit') }}</th><th class="text-right">{{ $t('common.amount') }}</th><th class="text-right">{{ $t('sales.col.returned') }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="line in sale.lines" :key="line.lineId">
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
          <div class="receipt-row"><span class="label">{{ $t('common.total') }}</span><strong class="val tabular">{{ money(financial.total) }}</strong></div>
          <div class="receipt-row"><span class="label">{{ $t('sales.returnedAmount') }}</span><span class="val tabular">{{ money(financial.returned) }}</span></div>
          <div class="receipt-row"><span class="label">{{ $t('sales.paidNet') }}</span><span class="val tabular">{{ money(financial.paid) }}</span></div>
          <div class="receipt-row total-receipt-row"><span class="label">{{ $t('sales.col.balance') }}</span><strong class="val tabular">{{ money(financial.balanceDue) }}</strong></div>
        </div>
        <div v-if="sale.payments && sale.payments.length" class="mt-3">
          <div class="form-label">{{ $t('sales.paymentHistory') }}</div>
          <div v-for="(p, i) in sale.payments" :key="i" class="text-caption tabular">
            {{ formatDate(p.at) }} · {{ p.kind === 'refund' ? $t('sales.refund') : $t('sales.collection') }} · {{ $payment(p.method) }} · {{ money(p.amount) }}
          </div>
        </div>
      </v-card-text>
      <v-card-actions class="dialog-actions">
        <v-spacer></v-spacer>
        <v-btn v-if="sale" size="small" class="jp-secondary" data-test="print-receipt" @click="print">
          <v-icon start size="14">mdi-printer-outline</v-icon>
          {{ $t('sales.printReceipt') }}
        </v-btn>
        <v-btn size="small" class="jp-secondary" @click="open = false">{{ $t('common.close') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { formatGrams, formatTry, purityLabel } from '@/services/finance';
import { laborText, saleFinancial, saleStatusBadge, saleStatusLabel, type SaleFinancial, type SaleView } from '@/services/saleView';
import { buildReceiptHtml, type ReceiptLabels } from '@/services/receipt';
import { printDocument } from '@/services/print';
import { fetchBusinessProfile, type BusinessProfile } from '@/services/businessProfile';
import { dateTime, n, t } from '@/i18n';

const RECEIPT_KEYS: Array<keyof ReceiptLabels> = [
  'title', 'saleNo', 'date', 'customer', 'product', 'quantity', 'total', 'subtotal', 'discount',
  'vatIncluded', 'paid', 'balanceDue', 'taxOffice', 'taxNumber', 'notInvoice',
];

/** Sale details (lines, gram pricing, payments) and the printable slip. */
export default defineComponent({
  name: 'SaleDetailDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    sale: { type: Object as PropType<SaleView | null>, default: null },
  },
  emits: ['update:modelValue'],
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
    financial(): SaleFinancial {
      return saleFinancial(this.sale);
    },
  },
  methods: {
    money: formatTry,
    grams: formatGrams,
    purityText: purityLabel,
    laborText,
    statusLabel: saleStatusLabel,
    statusBadge: saleStatusBadge,
    formatDate(value?: string) {
      return dateTime(value);
    },
    async print() {
      if (!this.sale) return;
      let profile: Partial<BusinessProfile> = {};
      try {
        profile = await fetchBusinessProfile();
      } catch {
        // The slip still prints without the business header.
      }
      const labels = Object.fromEntries(RECEIPT_KEYS.map((key) => [key, t(`sales.receipt.${key}`)])) as unknown as ReceiptLabels;
      printDocument(buildReceiptHtml(this.sale, profile, labels, {
        money: (value) => formatTry(value),
        date: (value) => dateTime(value),
        number: (value) => n(value),
      }));
    },
  },
});
</script>

<style scoped src="./sale-dialog.css"></style>
