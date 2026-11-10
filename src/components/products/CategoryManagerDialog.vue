<template>
  <v-dialog v-model="open" max-width="500px">
    <v-card class="pa-2">
      <v-card-title class="dialog-header">
        <v-icon size="18" color="primary" class="mr-2">mdi-shape-outline</v-icon>
        {{ $t('products.urunKategorileriYonetimi') }}
      </v-card-title>
      <v-card-text>
        <div class="d-flex gap-2 align-center mb-3">
          <input
            v-model.trim="name"
            type="text"
            :placeholder="$t('products.yeniKategoriAdiOrnPirlanta')"
            :aria-label="$t('products.kategoriAdi')"
            class="form-input-full"
            @keydown.enter.prevent="add"
          />
          <v-btn size="small" class="jp-primary ml-2" :disabled="!name" :loading="adding" @click="add">
            {{ $t('common.add') }}
          </v-btn>
        </div>
        <div class="category-scroll" tabindex="0" role="region" :aria-label="$t('products.kategoriler')">
          <table class="jp-enterprise-table">
            <thead>
              <tr>
                <th>{{ $t('products.kategoriAdi') }}</th>
                <th class="text-center" style="width: 70px;">{{ $t('products.islem') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="cat in categories" :key="cat._id">
                <td class="font-weight-medium">{{ cat.name }}</td>
                <td class="text-center">
                  <v-btn
                    v-if="$can('catalog:delete')"
                    icon
                    size="x-small"
                    variant="text"
                    color="error"
                    :title="$t('products.kategoriyiSil')"
                    :aria-label="$t('products.kategoriyiSil')"
                    @click="remove(cat._id)"
                  >
                    <v-icon size="14">mdi-trash-can-outline</v-icon>
                  </v-btn>
                </td>
              </tr>
              <tr v-if="!categories.length">
                <td colspan="2" class="empty-state-cell">{{ $t('products.henuzKategoriBulunmuyor') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </v-card-text>
      <v-card-actions class="dialog-actions">
        <v-spacer></v-spacer>
        <v-btn size="small" class="jp-secondary" @click="open = false">{{ $t('common.close') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import apiService from '@/services/api';
import { errorMessage } from '@/services/finance';
import { t } from '@/i18n';

export interface Category { _id: number; name: string }

/** Adds and removes product categories; emits the new list as `update:categories`. */
export default defineComponent({
  name: 'CategoryManagerDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    categories: { type: Array as PropType<Category[]>, default: () => [] },
  },
  emits: ['update:modelValue', 'update:categories'],
  data: () => ({ name: '', adding: false }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
  },
  methods: {
    async add() {
      if (!this.name) return;
      this.adding = true;
      try {
        const created = await apiService.post<Category>('/api/categories', { name: this.name });
        this.$emit('update:categories', [...this.categories, created]);
        this.name = '';
        this.$store.dispatch('notifications/showSuccess', t('products.yeniKategoriBasariylaEklendi'));
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('products.kategoriEklenemediP0', { p0: errorMessage(err) }));
      } finally {
        this.adding = false;
      }
    },
    async remove(id: number) {
      try {
        await apiService.delete(`/api/categories/${id}`);
        this.$emit('update:categories', this.categories.filter((c) => c._id !== id));
        this.$store.dispatch('notifications/showSuccess', t('products.kategoriSilindi'));
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('products.kategoriSilinemediP0', { p0: errorMessage(err) }));
      }
    },
  },
});
</script>

<style scoped src="@/styles/dialog.css"></style>

<style scoped>
.category-scroll {
  max-height: 250px;
  overflow: auto;
}
</style>
