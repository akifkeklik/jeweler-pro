<template>
  <v-dialog v-model="open" max-width="600px" persistent>
    <v-card class="pa-2">
      <v-card-title class="dialog-header">
        <v-icon size="18" color="warning" class="mr-2">mdi-pencil</v-icon>
        {{ $t('products.urunDuzenleP0', { p0: form._id }) }}
      </v-card-title>
      <v-card-text>
        <form class="edit-form-grid" @submit.prevent="save">
          <div class="col-span-2">
            <label class="form-label" for="product-edit-name">{{ $t('products.urunAdi') }}</label>
            <input id="product-edit-name" v-model.trim="form.name" type="text" class="form-input-full" required />
          </div>
          <div>
            <label class="form-label" for="product-edit-category">{{ $t('products.kategori') }}</label>
            <select id="product-edit-category" v-model="form.categoryId" class="form-select-full">
              <option v-for="c in categories" :key="c._id" :value="c._id">{{ c.name }}</option>
            </select>
          </div>
          <div>
            <label class="form-label" for="product-edit-material">{{ $t('products.hammadde') }}</label>
            <select id="product-edit-material" v-model="form.materialId" class="form-select-full">
              <option v-for="m in materials" :key="m._id" :value="m._id">{{ m.name }}</option>
            </select>
          </div>
          <div>
            <label class="form-label" for="product-edit-weight">{{ $t('products.agirlikGram') }}</label>
            <input id="product-edit-weight" v-model.number="form.weight" type="number" step="0.01" min="0.01" class="form-input-full tabular" required />
          </div>
          <div>
            <label class="form-label" for="product-edit-stock">{{ $t('products.stokAdedi') }} <span v-if="!canAdjust" class="text-disabled">{{ $t('products.degisiklikIcinYetkiGerekir') }}</span></label>
            <input id="product-edit-stock" v-model.number="form.stock" type="number" min="0" class="form-input-full tabular" :disabled="!canAdjust" required />
          </div>
          <div>
            <label class="form-label" for="product-edit-cost">{{ $t('products.birimMaliyet') }}</label>
            <input id="product-edit-cost" v-model.number="form.costPrice" type="number" step="0.01" min="0" class="form-input-full tabular" :disabled="!canAdjust" />
          </div>
          <div>
            <label class="form-label" for="product-edit-price">{{ isGram ? $t('products.listeFiyatiSatistaCanliGram') : $t('products.satisFiyati') }}</label>
            <input id="product-edit-price" v-model.number="form.price" type="number" step="0.01" min="0" class="form-input-full tabular" :required="!isGram" />
            <p v-if="canAdjust" class="text-caption text-disabled mt-1">{{ $t('products.stokVeyaMaliyetDegisikligiGerekcesiyle') }}</p>
          </div>
          <div class="col-span-2">
            <label class="form-label" for="product-edit-barcode">{{ $t('products.barkod') }}</label>
            <input id="product-edit-barcode" v-model.trim="form.barcode" type="text" class="form-input-full tabular" />
          </div>
          <div class="col-span-2">
            <label class="form-label" for="product-edit-description">{{ $t('common.description') }}</label>
            <textarea id="product-edit-description" v-model.trim="form.description" rows="2" class="form-textarea-full"></textarea>
          </div>
        </form>
      </v-card-text>
      <v-card-actions class="dialog-actions">
        <v-spacer></v-spacer>
        <v-btn size="small" class="jp-secondary" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn size="small" class="jp-primary" :loading="saving" @click="save">{{ $t('common.saveChanges') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import apiService from '@/services/api';
import { errorMessage } from '@/services/finance';
import { hasPermission } from '@/services/authSession';
import { t } from '@/i18n';

interface Ref { _id: number; name: string }
export interface EditableProduct {
  _id: number;
  name: string;
  pricingMode?: 'fixed' | 'gram';
  categoryId?: number | Ref | null;
  materialId?: number | Ref | null;
  weight?: number;
  stock?: number;
  costPrice?: number | null | '';
  price?: number | null | '';
  barcode?: string | null;
  description?: string;
}

const idOf = (value: EditableProduct['categoryId']) => (value && typeof value === 'object' ? value._id : value ?? null);
const numberOrNull = (value: unknown) => (value === '' || value === null || value === undefined ? null : Number(value));

/** Edits a catalogue item. Stock and cost need inventory:adjust (the server enforces it too). */
export default defineComponent({
  name: 'ProductEditDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    product: { type: Object as PropType<EditableProduct | null>, default: null },
    categories: { type: Array as PropType<Ref[]>, default: () => [] },
    materials: { type: Array as PropType<Ref[]>, default: () => [] },
  },
  emits: ['update:modelValue', 'saved'],
  data: () => ({ saving: false, form: { _id: 0, name: '' } as EditableProduct }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
    isGram(): boolean {
      return this.form.pricingMode === 'gram';
    },
    canAdjust(): boolean {
      return hasPermission('inventory:adjust');
    },
  },
  watch: {
    modelValue(value: boolean) {
      if (value && this.product) {
        this.form = { ...this.product, categoryId: idOf(this.product.categoryId), materialId: idOf(this.product.materialId) };
      }
    },
  },
  methods: {
    async save() {
      if (!this.form.name || (!this.isGram && Number(this.form.price) <= 0)) return;
      this.saving = true;
      try {
        const payload = {
          name: this.form.name,
          categoryId: this.form.categoryId,
          materialId: this.form.materialId,
          weight: Number(this.form.weight),
          price: numberOrNull(this.form.price) ?? undefined,
          costPrice: numberOrNull(this.form.costPrice),
          barcode: this.form.barcode || undefined,
          description: this.form.description,
          stock: Number(this.form.stock),
        };
        const updated = await apiService.put<EditableProduct>(`/api/products/${this.form._id}`, payload);
        this.$store.dispatch('notifications/showSuccess', t('products.urunBasariylaGuncellendi'));
        this.open = false;
        this.$emit('saved', updated);
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('products.guncellemeHatasiP0', { p0: errorMessage(err) }));
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped src="@/styles/dialog.css"></style>

<style scoped>
.edit-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.col-span-2 {
  grid-column: span 2;
}
@media (max-width: 600px) {
  .edit-form-grid { grid-template-columns: minmax(0, 1fr); }
  .col-span-2 { grid-column: auto; }
}
</style>
