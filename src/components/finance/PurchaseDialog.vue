<template>
  <v-dialog v-model="open" max-width="760px" persistent>
    <v-card class="pa-2">
      <v-card-title class="dialog-header"><v-icon size="18" color="primary" class="mr-2">mdi-package-variant-plus</v-icon>{{ $t('finance.yeniAlisStokGirisi') }}</v-card-title>
      <v-card-text>
        <div class="form-grid-2">
          <div>
            <label class="form-label" for="purchase-f6">{{ $t('finance.tedarikci2') }}</label>
            <select id="purchase-f6" v-model="form.supplierId" class="form-select-full">
              <option value="" disabled>{{ $t('common.select') }}</option>
              <option v-for="s in suppliers" :key="s._id" :value="s._id">{{ s.name }}</option>
            </select>
          </div>
          <div><label class="form-label" for="purchase-f7">{{ $t('finance.faturaNo') }}</label><input id="purchase-f7" v-model.trim="form.invoiceNo" type="text" maxlength="60" class="form-input-full" /></div>
        </div>
        <div class="purchase-lines mt-3">
          <div v-for="(line, index) in form.lines" :key="line.key" class="purchase-row">
            <select v-model="line.kind" class="form-select-full">
              <option value="product">{{ $t('common.product') }}</option>
              <option value="metal">{{ $t('finance.hasHurdaMaden') }}</option>
            </select>
            <template v-if="line.kind === 'product'">
              <select v-model="line.productId" class="form-select-full">
                <option value="" disabled>{{ $t('finance.urunSecin') }}</option>
                <option v-for="p in products" :key="p._id" :value="p._id">{{ $t('finance.p0StokP1', { p0: p.name, p1: p.stock }) }}</option>
              </select>
              <input v-model.number="line.quantity" type="number" min="1" :placeholder="$t('common.quantity')" class="form-input-full tabular text-right" />
              <input v-model.trim="line.unitCost" type="text" inputmode="decimal" :placeholder="$t('finance.birimMaliyet')" class="form-input-full tabular text-right" />
            </template>
            <template v-else>
              <select v-model.number="line.karat" class="form-select-full">
                <option v-for="o in purityOptions" :key="o.karat" :value="o.karat">{{ o.label }}</option>
              </select>
              <input v-model.trim="line.weightGrams" type="text" inputmode="decimal" :placeholder="$t('finance.gram')" class="form-input-full tabular text-right" />
              <input v-model.trim="line.totalCost" type="text" inputmode="decimal" :placeholder="$t('finance.toplamTutar')" class="form-input-full tabular text-right" />
            </template>
            <v-btn icon size="x-small" variant="text" color="error" :disabled="form.lines.length === 1" @click="form.lines.splice(index, 1)"><v-icon size="15">mdi-close</v-icon></v-btn>
          </div>
          <v-btn size="x-small" variant="text" color="primary" @click="addLine"><v-icon start size="14">mdi-plus</v-icon> {{ $t('finance.satirEkle') }}</v-btn>
        </div>
        <div class="form-grid-2 mt-3">
          <div>
            <label class="form-label" for="purchase-f8">{{ $t('finance.pesinOdemeYontemi') }}</label>
            <select id="purchase-f8" v-model="form.paymentMethod" class="form-select-full">
              <option value="havale">{{ $t('finance.havaleEft') }}</option>
              <option value="nakit">{{ $t('finance.nakit') }}</option>
              <option value="kredi kartı">{{ $t('finance.krediKarti') }}</option>
            </select>
          </div>
          <div><label class="form-label" for="purchase-f9">{{ $t('finance.pesinOdenenBossaTamamiTedarikci') }}</label><input id="purchase-f9" v-model.trim="form.paymentAmount" type="text" inputmode="decimal" placeholder="0.00" class="form-input-full tabular" /></div>
        </div>
        <p class="text-caption text-disabled mt-2">{{ $t('finance.toplamVeStokEtkisiSunucuda') }}</p>
      </v-card-text>
      <v-card-actions class="dialog-actions">
        <v-spacer></v-spacer>
        <v-btn size="small" class="jp-secondary" :disabled="saving" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn size="small" class="jp-primary" :loading="saving" :disabled="!form.supplierId" @click="submit">{{ $t('finance.alisiKaydet') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import apiService from '@/services/api';
import { confirmAction } from '@/services/confirm';
import { crossBranchTarget, errorMessage, newIdempotencyKey, PURITY_OPTIONS } from '@/services/finance';
import { emptyPurchase, purchaseLine, purchasePayload } from '@/services/purchaseForm';
import { t } from '@/i18n';

/**
 * New purchase (stock intake) from a supplier: product lines and/or fine-gold
 * scrap lines, with an optional up-front payment. One idempotency key per
 * opened dialog; a cross-branch purchase asks for explicit confirmation.
 */
export default defineComponent({
  name: 'PurchaseDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    suppliers: { type: Array as PropType<Array<{ _id: number; name: string }>>, default: () => [] },
    products: { type: Array as PropType<Array<{ _id: number; name: string; stock: number }>>, default: () => [] },
  },
  emits: ['update:modelValue', 'saved'],
  data: () => ({ form: emptyPurchase(), saving: false, purityOptions: PURITY_OPTIONS }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
  },
  watch: {
    modelValue(value: boolean) {
      if (!value) return;
      this.form = { ...emptyPurchase(this.suppliers[0]?._id || ''), key: newIdempotencyKey('purchase') };
    },
  },
  methods: {
    addLine() {
      this.form.lines.push(purchaseLine());
    },
    async submit() {
      const payload = purchasePayload(this.form);
      const headers = { 'Idempotency-Key': this.form.key };
      this.saving = true;
      try {
        try {
          await apiService.post('/api/purchases', payload, { headers });
        } catch (err) {
          // Admin buying into another branch's stock: the branch must be confirmed explicitly.
          const branch = crossBranchTarget(err);
          if (!branch || !(await confirmAction({
            message: t('finance.crossBranch', { branch }),
            confirmLabel: t('sales.crossBranchConfirm', { branch }),
            tone: 'warning',
          }))) throw err;
          await apiService.post('/api/purchases', { ...payload, branch }, { headers });
        }
        this.open = false;
        this.$store.dispatch('notifications/showSuccess', t('finance.alisKaydedildiStokVeTedarikci'));
        this.$emit('saved');
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('finance.alisKaydedilemediP0', { p0: errorMessage(err) }));
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped src="@/styles/finance-form.css"></style>

<style scoped>
.purchase-lines { border: 1px solid var(--jp-border); border-radius: var(--jp-radius-sm); padding: 8px; background: var(--jp-surface-muted); }
.purchase-row { display: grid; grid-template-columns: 130px 1fr 80px 130px 28px; gap: 6px; align-items: center; margin-bottom: 6px; }
@media (max-width: 720px) {
  .purchase-row { grid-template-columns: 1fr 1fr; }
}
</style>
