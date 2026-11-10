<template>
  <v-dialog v-model="open" max-width="520px">
    <v-card class="pa-3">
      <v-card-title class="dialog-header">
        <v-icon size="18" color="primary" class="mr-2">mdi-cash-register</v-icon>
        {{ $t('customers.cariTahsilatOdemeGirisi') }}
      </v-card-title>
      <v-card-text>
        <div class="text-caption text-disabled mb-3">
          {{ $t('common.customer') }} <strong>{{ customer?.name }}</strong>
        </div>

        <div class="form-group mb-3">
          <label class="form-label" for="voucher-type">{{ $t('customers.islemTuru') }}</label>
          <select id="voucher-type" v-model="form.type" class="settings-select-full">
            <option value="tahsilat">{{ $t('customers.musteridenTahsilatBorcDuser') }}</option>
            <option value="tediye">{{ $t('customers.musteriyeOdemeBorcArtarAlacak') }}</option>
            <!-- Opening balances move equity: the backend requires accounts:manage. -->
            <option v-if="$can('accounts:manage')" value="devir">{{ $t('customers.devirAcilisBakiyesi') }}</option>
            <option value="hurda_alimi">{{ $t('customers.hurdaEskiAltinAlimi') }}</option>
          </select>
        </div>

        <div v-if="form.type === 'devir'" class="form-group mb-3">
          <label class="form-label" for="voucher-direction">{{ $t('customers.devirYonu') }}</label>
          <select id="voucher-direction" v-model="form.direction" class="settings-select-full">
            <option value="borc">{{ $t('customers.musteriBizeBorclu') }}</option>
            <option value="alacak">{{ $t('customers.bizMusteriyeBorcluyuz') }}</option>
          </select>
        </div>

        <div v-if="form.type !== 'devir'" class="form-group mb-3">
          <label class="form-label" for="voucher-method">{{ $t('customers.odemeAraci') }}</label>
          <select id="voucher-method" v-model="form.paymentMethod" class="settings-select-full">
            <option value="nakit">{{ $t('customers.nakitTl') }}</option>
            <option value="kredi kartı">{{ $t('customers.krediKartiPos') }}</option>
            <option value="havale">{{ $t('customers.bankaHavalesiEft') }}</option>
            <option v-if="form.type === 'hurda_alimi'" value="cari">{{ $t('customers.musteriCarisineAlacakYaz') }}</option>
          </select>
        </div>

        <template v-if="form.type === 'hurda_alimi'">
          <div class="d-flex gap-2 mb-3">
            <div class="form-group flex-1">
              <label class="form-label" for="voucher-weight">{{ $t('customers.brutGramaj') }}</label>
              <input id="voucher-weight" v-model.trim="form.weightGrams" type="text" inputmode="decimal" placeholder="0.000" class="settings-input-full tabular" />
            </div>
            <div class="form-group flex-1">
              <label class="form-label" for="voucher-karat">{{ $t('customers.ayar') }}</label>
              <select id="voucher-karat" v-model.number="form.karat" class="settings-select-full">
                <option v-for="o in purityOptions" :key="o.karat" :value="o.karat">{{ o.label }}</option>
              </select>
            </div>
            <div class="form-group flex-1">
              <label class="form-label" for="voucher-deduction">{{ $t('customers.fire') }}</label>
              <input id="voucher-deduction" v-model.trim="form.deductionMilyem" type="text" inputmode="decimal" placeholder="0" class="settings-input-full tabular" />
            </div>
          </div>
          <div class="d-flex gap-2 mb-3">
            <div class="form-group flex-1">
              <label class="form-label" for="voucher-agreed">{{ $t('customers.anlasilanTutarBossaFiyattanHesaplanir') }}</label>
              <input id="voucher-agreed" v-model.trim="form.amountTry" type="text" inputmode="decimal" placeholder="0.00" class="settings-input-full tabular" />
            </div>
            <div class="form-group flex-1">
              <label class="form-label" for="voucher-price">{{ $t('customers.hasAlisGramFiyatiBossa') }}</label>
              <input id="voucher-price" v-model.trim="form.manualPricePerGram" type="text" inputmode="decimal" :placeholder="$t('customers.canliAlisFiyati')" class="settings-input-full tabular" />
            </div>
          </div>
        </template>

        <div v-else class="d-flex gap-2 mb-3">
          <div class="form-group flex-1">
            <label class="form-label" for="voucher-amount">{{ $t('customers.tutar') }}</label>
            <input id="voucher-amount" v-model.trim="form.amountTry" type="text" inputmode="decimal" placeholder="0.00" class="settings-input-full tabular" />
          </div>
          <div class="form-group flex-1">
            <label class="form-label" for="voucher-gold">{{ $t('customers.hasAltinGram') }}</label>
            <input id="voucher-gold" v-model.trim="form.amountGoldGrams" type="text" inputmode="decimal" placeholder="0.000" class="settings-input-full tabular" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="voucher-description">{{ $t('customers.aciklamaMakbuzNotu') }}</label>
          <input id="voucher-description" v-model.trim="form.description" type="text" :placeholder="$t('customers.orn22AyarBilezikBozdurma')" class="settings-input-full" />
        </div>
      </v-card-text>
      <v-card-actions class="dialog-actions">
        <v-spacer></v-spacer>
        <v-btn size="small" class="jp-secondary" @click="open = false">{{ $t('customers.iptal') }}</v-btn>
        <v-btn size="small" class="jp-primary" :loading="saving" @click="submit">{{ $t('customers.islemiKaydet') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import apiService from '@/services/api';
import { errorMessage, newIdempotencyKey, PURITY_OPTIONS } from '@/services/finance';
import { buildVoucherPayload, emptyVoucher, type VoucherForm } from '@/services/customerVoucher';
import { t } from '@/i18n';

/**
 * Collection, payment, opening balance or scrap-gold buy-back on a customer
 * account. One idempotency key per opened dialog: a retried submit is
 * applied once. Emits `saved` with the customer id.
 */
export default defineComponent({
  name: 'CustomerVoucherDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    customer: { type: Object as PropType<{ _id: number; name: string } | null>, default: null },
  },
  emits: ['update:modelValue', 'saved'],
  data: () => ({
    form: emptyVoucher() as VoucherForm,
    key: '',
    saving: false,
    purityOptions: PURITY_OPTIONS,
  }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
  },
  watch: {
    modelValue(value: boolean) {
      if (!value) return;
      this.form = emptyVoucher();
      this.key = newIdempotencyKey('voucher');
    },
  },
  methods: {
    async submit() {
      if (!this.customer) return;
      const built = buildVoucherPayload(this.customer._id, this.form);
      if (!built.ok) {
        this.$store.dispatch('notifications/showError', built.reason === 'scrap_weight_required'
          ? t('customers.lutfenHurdaGramajiniGiriniz')
          : t('customers.lutfenGecerliBirTutarVeya'));
        return;
      }
      this.saving = true;
      try {
        await apiService.post('/api/cash/transactions', built.payload, { headers: { 'Idempotency-Key': this.key } });
        this.$store.dispatch('notifications/showSuccess', t('customers.cariIslemKaydedildiKasaVe'));
        this.open = false;
        this.$emit('saved', built.payload.customerId);
      } catch (err) {
        const message = (err as { code?: string })?.code === 'MARKET_PRICE_UNAVAILABLE'
          ? t('customers.canliHasAlisFiyatiAlinamadi')
          : errorMessage(err);
        this.$store.dispatch('notifications/showError', t('customers.islemHatasiP0', { p0: message }));
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped src="@/styles/dialog.css"></style>

<style scoped>
.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.flex-1 {
  flex: 1;
  min-width: 0;
}
.settings-input-full,
.settings-select-full {
  width: 100%;
  height: 36px;
}
</style>
