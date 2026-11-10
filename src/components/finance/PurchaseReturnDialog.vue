<template>
  <v-dialog v-model="open" max-width="760px" persistent>
    <v-card v-if="purchase" class="pa-2">
      <v-card-title class="dialog-header"><v-icon size="18" color="primary" class="mr-2">mdi-keyboard-return</v-icon>{{ $t('finance.alisP0IadeAlisFiyat', { p0: purchase._id }) }}</v-card-title>
      <v-card-text>
        <div class="form-grid-2">
          <div>
            <label class="form-label" for="return-f12">{{ $t('finance.tur') }}</label>
            <select id="return-f12" v-model="form.kind" class="form-select-full">
              <option value="goods">{{ $t('finance.malIadesiStoktanCikar') }}</option>
              <option value="price_adjustment">{{ $t('finance.fiyatFarkiAlacakDekontuStok') }}</option>
            </select>
          </div>
          <div><label class="form-label" for="return-f13">{{ $t('finance.belgeNoIadeFaturasiDekont') }}</label><input id="return-f13" v-model.trim="form.creditNoteNo" type="text" maxlength="60" class="form-input-full" /></div>
        </div>
        <div class="table-scroll-wrap mt-3" style="max-height: 240px;">
          <table class="jp-enterprise-table">
            <thead><tr><th>{{ $t('common.item') }}</th><th class="text-right">{{ $t('common.received') }}</th><th class="text-right">{{ $t('finance.iadeEdilen') }}</th><th class="text-right">{{ $t('finance.kalanDeger') }}</th><th class="text-right" style="width: 130px;">{{ form.kind === 'goods' ? $t('finance.iadeMiktari') : $t('finance.farkTutariTl') }}</th></tr></thead>
            <tbody>
              <tr v-for="l in purchase.lines" :key="l.lineId">
                <td>{{ l.itemType === 'metal' ? `${l.metal} ${purityText(l.purity)}` : l.productName }}</td>
                <td class="text-right tabular">{{ l.itemType === 'metal' ? `${l.weightGrams} gr` : l.quantity }}</td>
                <td class="text-right tabular">{{ l.itemType === 'metal' ? `${l.returnedWeightGrams} gr` : l.returnedQuantity }}</td>
                <td class="text-right tabular">{{ money(l.remainingValue) }}</td>
                <td><input v-model.trim="form.inputs[l.lineId]" :disabled="!(l.remainingValue > 0)" type="text" inputmode="decimal" :placeholder="form.kind === 'goods' ? (l.itemType === 'metal' ? 'gr' : 'adet') : '0.00'" class="form-input-full tabular text-right" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="form-grid-2 mt-3">
          <div><label class="form-label" for="return-f14">{{ $t('finance.gerekce') }}</label><input id="return-f14" v-model.trim="form.reason" type="text" maxlength="300" class="form-input-full" /></div>
          <div class="form-grid-2">
            <div>
              <label class="form-label" for="return-f15">{{ $t('finance.tedarikciGeriOdemesi') }}</label>
              <select id="return-f15" v-model="form.refundMethod" class="form-select-full">
                <option value="havale">{{ $t('finance.havaleEft') }}</option>
                <option value="nakit">{{ $t('finance.nakit') }}</option>
              </select>
            </div>
            <div><label class="form-label" for="return-f16">{{ $t('finance.tutarOps') }}</label><input id="return-f16" v-model.trim="form.refundAmount" type="text" inputmode="decimal" placeholder="0.00" class="form-input-full tabular" /></div>
          </div>
        </div>
        <div v-if="hint" class="return-hint mt-2">{{ hint }}</div>
        <p class="text-caption text-disabled mt-2">
          {{ $t('finance.malIadesindeTedarikciAlacagiOrijinal') }}
        </p>
      </v-card-text>
      <v-card-actions class="dialog-actions">
        <v-spacer></v-spacer>
        <v-btn size="small" class="jp-secondary" :disabled="saving" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn size="small" class="jp-primary" :loading="saving" :disabled="!form.reason || !lineCount" @click="submit">{{ $t('common.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import apiService from '@/services/api';
import { errorCode, errorMessage, formatTry, newIdempotencyKey, purityLabel } from '@/services/finance';
import { buildPurchaseReturn, errorDetails } from '@/services/operations';
import { t } from '@/i18n';

interface ReturnLine {
  lineId: number;
  itemType: 'product' | 'metal';
  productName?: string;
  metal?: string;
  purity?: number;
  quantity?: number;
  returnedQuantity?: number;
  weightGrams?: string;
  returnedWeightGrams?: string;
  remainingValue: number;
}
interface ReturnablePurchase { _id: number; lines: ReturnLine[] }

const emptyForm = () => ({
  kind: 'goods' as 'goods' | 'price_adjustment',
  inputs: {} as Record<number, string>,
  reason: '',
  creditNoteNo: '',
  refundMethod: 'havale',
  refundAmount: '',
  key: '',
});

/**
 * Purchase return (goods back to the supplier) or price adjustment (credit
 * note, stock unchanged), with an optional supplier refund. A failed stock
 * check shows what is still available and rotates the idempotency key.
 */
export default defineComponent({
  name: 'PurchaseReturnDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    purchase: { type: Object as PropType<ReturnablePurchase | null>, default: null },
  },
  emits: ['update:modelValue', 'saved'],
  data: () => ({ form: emptyForm(), hint: '', saving: false }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
    payload(): Record<string, unknown> {
      if (!this.purchase) return { lines: [] };
      return buildPurchaseReturn(this.form.kind, this.purchase.lines, this.form.inputs, this.form);
    },
    lineCount(): number {
      return (this.payload.lines as unknown[]).length;
    },
  },
  watch: {
    modelValue(value: boolean) {
      if (!value) return;
      this.form = { ...emptyForm(), key: newIdempotencyKey('preturn') };
      this.hint = '';
    },
  },
  methods: {
    money: formatTry,
    purityText: purityLabel,
    async submit() {
      if (!this.purchase) return;
      this.saving = true;
      this.hint = '';
      try {
        await apiService.post(`/api/purchases/${this.purchase._id}/returns`, this.payload, { headers: { 'Idempotency-Key': this.form.key } });
        this.open = false;
        this.$store.dispatch('notifications/showSuccess', this.form.kind === 'goods'
          ? t('finance.iadeAlisKaydedildiStokVe')
          : t('finance.fiyatFarkiKaydedildiTedarikciCarisi'));
        this.$emit('saved');
      } catch (err) {
        if (errorCode(err) === 'INSUFFICIENT_STOCK_FOR_RETURN') {
          const d = (errorDetails(err) || {}) as { available?: number; availableWeightGrams?: number };
          this.hint = t('finance.insufficientForReturn', { available: d.available ?? d.availableWeightGrams ?? 0 });
          this.form.key = newIdempotencyKey('preturn');
        }
        this.$store.dispatch('notifications/showError', errorMessage(err));
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped src="@/styles/finance-form.css"></style>

<style scoped>
.table-scroll-wrap { flex: 1; min-height: 0; overflow: auto; }
.return-hint { font-size: 12px; color: var(--jp-warning); }
</style>
