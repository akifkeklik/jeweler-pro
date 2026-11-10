<template>
  <v-dialog v-model="open" max-width="420px" persistent>
    <v-card class="pa-2">
      <v-card-title class="dialog-header">
        <v-icon size="18" color="success" class="mr-2">mdi-cash-plus</v-icon>
        {{ $t('sales.paymentTitle', { id: sale?._id }) }}
      </v-card-title>
      <v-card-text>
        <div class="text-caption text-disabled mb-2">{{ $t('sales.outstanding') }}: <strong class="tabular">{{ money(balanceDue) }}</strong></div>
        <div class="form-grid-2">
          <div>
            <label class="form-label" for="pay-method">{{ $t('sales.paymentMethod') }}</label>
            <select id="pay-method" v-model="form.method" class="form-select-full">
              <option value="nakit">{{ $t('payment.cash') }}</option>
              <option value="kredi kartı">{{ $t('payment.card') }}</option>
              <option value="havale">{{ $t('payment.transfer') }}</option>
            </select>
          </div>
          <div>
            <label class="form-label" for="pay-amount">{{ $t('sales.amountTry') }}</label>
            <input id="pay-amount" v-model.trim="form.amount" type="text" inputmode="decimal" class="form-input-full tabular" />
          </div>
        </div>
        <div v-if="form.method === 'kredi kartı' && providers.length" class="form-grid-2 mt-2">
          <div>
            <label class="form-label" for="pay-pos">POS</label>
            <select id="pay-pos" v-model="form.providerId" class="form-select-full">
              <option value="" disabled>{{ $t('common.select') }}</option>
              <option v-for="pp in providers" :key="pp._id" :value="pp._id">{{ pp.name }}</option>
            </select>
          </div>
          <div>
            <label class="form-label" for="pay-inst">{{ $t('sales.installmentLabel') }}</label>
            <select id="pay-inst" v-model.number="form.installments" class="form-select-full">
              <option v-for="n in installments" :key="n" :value="n">{{ installmentText(n) }}</option>
            </select>
          </div>
        </div>
      </v-card-text>
      <v-card-actions class="dialog-actions">
        <v-spacer></v-spacer>
        <v-btn size="small" class="jp-secondary" :disabled="saving" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn size="small" class="jp-primary" :loading="saving" :disabled="!isValidAmount(form.amount)" @click="submit">{{ $t('sales.collect') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import apiService from '@/services/api';
import { errorMessage, formatTry, isValidAmount, newIdempotencyKey, normalizeDecimalInput } from '@/services/finance';
import { posBlock } from '@/services/operations';
import { defaultProviderId, installmentsOf, loadActivePosProviders, type PosProviderOption } from '@/services/posProviders';
import { installmentText, saleFinancial, type SaleView } from '@/services/saleView';
import { t } from '@/i18n';

interface PaymentForm { method: string; amount: string; providerId: string; installments: number; key: string }

/** Collects a payment against an open sale (cash, card with POS, transfer). */
export default defineComponent({
  name: 'SalePaymentDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    sale: { type: Object as PropType<SaleView | null>, default: null },
  },
  emits: ['update:modelValue', 'saved'],
  data: () => ({
    saving: false,
    providers: [] as PosProviderOption[],
    form: { method: 'nakit', amount: '', providerId: '', installments: 1, key: '' } as PaymentForm,
  }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
    balanceDue(): number {
      return this.sale ? saleFinancial(this.sale).balanceDue : 0;
    },
    installments(): number[] {
      return installmentsOf(this.providers, this.form.providerId);
    },
  },
  watch: {
    async modelValue(value: boolean) {
      if (!value) return;
      // One idempotency key per dialog: a retried submit is applied once.
      this.form = { method: 'nakit', amount: this.balanceDue.toFixed(2), providerId: '', installments: 1, key: newIdempotencyKey('pay') };
      this.providers = await loadActivePosProviders();
      this.form.providerId = defaultProviderId(this.providers);
    },
  },
  methods: {
    money: formatTry,
    isValidAmount,
    installmentText,
    async submit() {
      if (!this.sale) return;
      this.saving = true;
      try {
        const pos = posBlock(this.form.method, this.form.providerId || defaultProviderId(this.providers), this.form.installments);
        await apiService.post(`/api/sales/${this.sale._id}/payments`, {
          method: this.form.method,
          amount: normalizeDecimalInput(this.form.amount),
          ...(pos ? { pos } : {}),
        }, { headers: { 'Idempotency-Key': this.form.key } });
        this.$store.dispatch('notifications/showSuccess', t('sales.paymentSaved'));
        this.open = false;
        this.$emit('saved');
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('sales.paymentFailed', { reason: errorMessage(err) }));
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped src="@/styles/dialog.css"></style>
