<template>
  <v-dialog v-model="open" max-width="480px">
    <v-card class="pa-2">
      <v-card-title class="dialog-header">
        <v-icon size="18" color="warning" class="mr-2">mdi-pencil</v-icon>
        {{ $t('sales.editTitle', { id: sale?._id }) }}
      </v-card-title>
      <v-card-text>
        <p class="text-caption text-disabled mb-3">{{ $t('sales.editHint') }}</p>
        <template v-if="form.legacy">
          <div class="form-row">
            <label class="form-label" for="edit-method">{{ $t('sales.legacyPayment') }}</label>
            <select id="edit-method" v-model="form.paymentMethod" class="form-select-full">
              <option value="nakit">{{ $t('payment.cash') }}</option>
              <option value="kredi kartı">{{ $t('payment.card') }}</option>
              <option value="havale">{{ $t('payment.transfer') }}</option>
            </select>
          </div>
          <div class="form-row mt-3">
            <label class="form-label" for="edit-date">{{ $t('sales.legacyDate') }}</label>
            <input id="edit-date" v-model="form.date" type="date" class="form-input-full" />
          </div>
        </template>
        <div class="form-row mt-3">
          <label class="form-label" for="edit-notes">{{ $t('common.note') }}</label>
          <input id="edit-notes" v-model.trim="form.notes" type="text" maxlength="200" class="form-input-full" />
        </div>
      </v-card-text>
      <v-card-actions class="dialog-actions">
        <v-spacer></v-spacer>
        <v-btn size="small" class="jp-secondary" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn size="small" class="jp-primary" :loading="saving" @click="save">{{ $t('common.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import apiService from '@/services/api';
import { errorMessage } from '@/services/finance';
import { t } from '@/i18n';
import type { SaleView } from '@/services/saleView';

interface EditForm { legacy: boolean; paymentMethod: string; date: string; notes: string }

/**
 * Edits the notes of a sale. Legacy sales (before the financial core) can
 * also change their payment method and date; journaled sales cannot.
 */
export default defineComponent({
  name: 'SaleEditDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    sale: { type: Object as PropType<SaleView | null>, default: null },
  },
  emits: ['update:modelValue', 'saved'],
  data: () => ({
    saving: false,
    form: { legacy: false, paymentMethod: 'nakit', date: '', notes: '' } as EditForm,
  }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
  },
  watch: {
    modelValue(value: boolean) {
      if (value && this.sale) {
        this.form = {
          legacy: !this.sale.financial?.journaled,
          paymentMethod: this.sale.paymentMethod || 'nakit',
          date: this.sale.date ? this.sale.date.split('T')[0] : '',
          notes: this.sale.notes || '',
        };
      }
    },
  },
  methods: {
    async save() {
      if (!this.sale) return;
      this.saving = true;
      try {
        const payload: Record<string, string> = { notes: this.form.notes };
        if (this.form.legacy) {
          payload.paymentMethod = this.form.paymentMethod;
          if (this.form.date) payload.date = this.form.date;
        }
        await apiService.put(`/api/sales/${this.sale._id}`, payload);
        this.$store.dispatch('notifications/showSuccess', t('sales.updated'));
        this.open = false;
        this.$emit('saved');
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('sales.updateFailed', { reason: errorMessage(err) }));
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped src="@/styles/dialog.css"></style>
