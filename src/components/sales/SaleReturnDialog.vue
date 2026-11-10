<template>
  <v-dialog v-model="open" max-width="560px" persistent>
    <v-card class="pa-2">
      <v-card-title class="dialog-header">
        <v-icon size="18" color="secondary" class="mr-2">mdi-keyboard-return</v-icon>
        {{ $t('sales.returnTitle', { id: sale?._id }) }}
      </v-card-title>
      <v-card-text v-if="sale">
        <table class="jp-enterprise-table">
          <thead><tr><th>{{ $t('common.product') }}</th><th class="text-right">{{ $t('sales.col.sold') }}</th><th class="text-right">{{ $t('sales.col.returnable') }}</th><th class="text-right" style="width: 90px;">{{ $t('sales.col.returnQty') }}</th></tr></thead>
          <tbody>
            <tr v-for="line in sale.lines || []" :key="line.lineId">
              <td>{{ line.productName }}</td>
              <td class="text-right tabular">{{ $n(line.quantity) }}</td>
              <td class="text-right tabular">{{ $n(returnable(line)) }}</td>
              <td><input v-model.number="form.quantities[line.lineId]" :aria-label="$t('sales.col.returnQty')" type="number" min="0" :max="returnable(line)" class="form-input-full tabular text-right" /></td>
            </tr>
          </tbody>
        </table>
        <div class="form-grid-2 mt-3">
          <div>
            <label class="form-label" for="ret-method">{{ $t('sales.refundMethod') }}</label>
            <select id="ret-method" v-model="form.refundMethod" class="form-select-full">
              <option value="cari">{{ $t('sales.refundToAccount') }}</option>
              <option value="nakit">{{ $t('sales.refundCash') }}</option>
              <option value="kredi kartı">{{ $t('sales.refundCard') }}</option>
              <option value="havale">{{ $t('sales.refundTransfer') }}</option>
            </select>
          </div>
          <div>
            <label class="form-label" for="ret-reason">{{ $t('sales.returnReason') }}</label>
            <input id="ret-reason" v-model.trim="form.reason" type="text" maxlength="200" class="form-input-full" />
          </div>
        </div>
        <p class="text-caption text-disabled mt-2">{{ $t('sales.returnHint') }}</p>
      </v-card-text>
      <v-card-actions class="dialog-actions">
        <v-spacer></v-spacer>
        <v-btn size="small" class="jp-secondary" :disabled="saving" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn size="small" class="jp-primary" :loading="saving" :disabled="!lines.length" @click="submit">{{ $t('sales.saveReturn') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import apiService from '@/services/api';
import { errorMessage, newIdempotencyKey } from '@/services/finance';
import { saleFinancial, type SaleLineView, type SaleView } from '@/services/saleView';
import { t } from '@/i18n';

interface ReturnForm { quantities: Record<number, number | ''>; refundMethod: string; reason: string; key: string }

/** Returns sale lines; refund to the customer account or by cash/card/transfer. */
export default defineComponent({
  name: 'SaleReturnDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    sale: { type: Object as PropType<SaleView | null>, default: null },
  },
  emits: ['update:modelValue', 'saved'],
  data: () => ({
    saving: false,
    form: { quantities: {}, refundMethod: 'cari', reason: '', key: '' } as ReturnForm,
  }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
    lines(): Array<{ lineId: number; quantity: number }> {
      return Object.entries(this.form.quantities)
        .map(([lineId, quantity]) => ({ lineId: Number(lineId), quantity: Number(quantity) || 0 }))
        .filter((l) => l.quantity > 0);
    },
  },
  watch: {
    modelValue(value: boolean) {
      if (!value || !this.sale) return;
      // Something was paid: refund it the same way by default; otherwise to the account.
      this.form = {
        quantities: {},
        refundMethod: saleFinancial(this.sale).paid > 0 ? 'nakit' : 'cari',
        reason: '',
        key: newIdempotencyKey('return'),
      };
    },
  },
  methods: {
    returnable(line: SaleLineView): number {
      return line.quantity - (line.returnedQuantity || 0);
    },
    async submit() {
      if (!this.sale) return;
      this.saving = true;
      try {
        await apiService.post(`/api/sales/${this.sale._id}/returns`, {
          lines: this.lines,
          refundMethod: this.form.refundMethod,
          reason: this.form.reason || undefined,
        }, { headers: { 'Idempotency-Key': this.form.key } });
        this.$store.dispatch('notifications/showSuccess', t('sales.returnSaved'));
        this.open = false;
        this.$emit('saved');
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('sales.returnFailed', { reason: errorMessage(err) }));
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped src="./sale-dialog.css"></style>
