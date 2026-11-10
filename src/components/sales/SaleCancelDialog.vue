<template>
  <v-dialog v-model="open" max-width="440px">
    <v-card class="pa-2">
      <v-card-title class="dialog-header">
        <v-icon size="18" color="error" class="mr-2">mdi-alert-circle</v-icon>
        {{ $t('sales.cancelTitle') }}
      </v-card-title>
      <v-card-text class="text-caption">
        <strong>{{ $t('sales.cancelIntro', { id: sale?._id }) }}</strong>
        <ul class="mt-2 ms-4">
          <li>{{ $t('sales.cancelStock') }}</li>
          <li>{{ $t('sales.cancelLedger') }}</li>
          <li>{{ $t('sales.cancelPayments') }}</li>
        </ul>
      </v-card-text>
      <v-card-actions class="dialog-actions">
        <v-spacer></v-spacer>
        <v-btn size="small" class="jp-secondary" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn size="small" class="jp-btn-danger" :loading="saving" @click="confirm">{{ $t('sales.cancelTitle') }}</v-btn>
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

/** Cancels a sale: the server reverses stock, books and payments. */
export default defineComponent({
  name: 'SaleCancelDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    sale: { type: Object as PropType<SaleView | null>, default: null },
  },
  emits: ['update:modelValue', 'saved'],
  data: () => ({ saving: false }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
  },
  methods: {
    async confirm() {
      if (!this.sale) return;
      this.saving = true;
      try {
        await apiService.delete(`/api/sales/${this.sale._id}`);
        this.$store.dispatch('notifications/showSuccess', t('sales.cancelled'));
        this.open = false;
        this.$emit('saved');
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('sales.cancelFailed', { reason: errorMessage(err) }));
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped src="./sale-dialog.css"></style>
