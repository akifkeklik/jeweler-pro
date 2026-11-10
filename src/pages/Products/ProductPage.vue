<template>
  <div class="jp-page-shell products-page-shell">
    <!-- Header -->
    <div class="jp-page-header">
      <div class="page-heading-left">
        <div>
          <div class="jp-section-label">{{ $t('products.katalogVeEnvanter') }}</div>
          <h1 class="page-title">
            <v-icon size="20" color="primary">mdi-diamond-stone</v-icon>
            {{ $t('products.urunKataloguStok') }}
          </h1>
        </div>
      </div>
      <div class="header-actions">
        <v-btn
          size="small"
          class="jp-secondary"
          :loading="loading"
          @click="fetchProducts"
        >
          <v-icon start size="14">mdi-refresh</v-icon>
          {{ $t('common.refresh') }}
        </v-btn>
        <v-btn
          size="small"
          class="jp-secondary"
          @click="dialogs.camera = true"
        >
          <v-icon start size="14">mdi-barcode-scan</v-icon>
          {{ $t('products.barkodTara') }}
        </v-btn>
        <v-btn
          size="small"
          class="jp-secondary"
          @click="dialogs.categories = true"
        >
          <v-icon start size="14">mdi-shape-outline</v-icon>
          {{ $t('products.kategoriler') }}
        </v-btn>
        <v-btn
          size="small"
          class="jp-primary"
          @click="dialogs.create = true"
        >
          <v-icon start size="14">mdi-plus</v-icon>
          {{ $t('products.yeniUrunEkle') }}
        </v-btn>
      </div>
    </div>

    <!-- Inventory KPI Stats Strip -->
    <div class="inventory-kpi-row">
      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-info);">
          <v-icon size="18">mdi-cube-outline</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('products.toplamCesit') }}</span>
          <div class="jp-stat-value tabular">{{ $t('products.p0Model', { p0: $n(urunler.length) }) }}</div>
        </div>
      </div>
      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-success);">
          <v-icon size="18">mdi-counter</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('products.toplamEnvanter') }}</span>
          <div class="jp-stat-value tabular">{{ $t('products.p0Adet', { p0: $n(totalStockQuantity) }) }}</div>
        </div>
      </div>
      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-primary);">
          <v-icon size="18">mdi-scale-balance</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('products.toplamAgirlik') }}</span>
          <div class="jp-stat-value tabular">{{ $weight(totalWeight) }}</div>
        </div>
      </div>
      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" :style="{ color: lowStockCount > 0 ? 'var(--jp-danger)' : 'var(--jp-success)' }">
          <v-icon size="18">mdi-alert-box-outline</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('products.kritikStok') }}</span>
          <div class="jp-stat-value tabular" :class="{ 'text-danger': lowStockCount > 0 }">
            {{ $t('products.p0Urun', { p0: $n(lowStockCount) }) }}
          </div>
        </div>
      </div>
    </div>

    <!-- Main Table Container Card (Strict Zero-Scroll Contract) -->
    <div class="products-main-card jp-card">
      <!-- Toolbar: Filters & Fast Search -->
      <div class="products-toolbar">
        <div class="search-input-wrap">
          <v-icon size="16" class="search-icon">mdi-magnify</v-icon>
          <input
            v-model.trim="search"
            type="search"
            :placeholder="$t('products.urunAdiBarkodVeyaKod')"
            class="products-search-field"
          />
        </div>

        <div class="filter-controls">
          <select v-model="categoryFilter" class="compact-select" :aria-label="$t('products.kategori')">
            <option value="">{{ $t('products.tumKategoriler') }}</option>
            <option v-for="c in categories" :key="c._id" :value="c._id">
              {{ c.name }}
            </option>
          </select>

          <select v-model="stockFilter" class="compact-select" :aria-label="$t('products.stokDurumu')">
            <option value="">{{ $t('products.tumStokSeviyeleri') }}</option>
            <option value="low">{{ $t('products.kritikStok5') }}</option>
            <option value="in">{{ $t('products.yeterliStok5') }}</option>
            <option value="out">{{ $t('products.tukenenler0') }}</option>
          </select>

          <span class="record-counter tabular">
            {{ $t('products.p0Urun', { p0: $n(urunler.length) }) }}
          </span>
        </div>
      </div>

      <!-- Product List Table -->
      <ProductList
        :urunler="urunler"
        :search="search"
        :category-filter="categoryFilter"
        :stock-filter="stockFilter"
        @urunSil="urunSil"
        @urunDuzenle="duzenlemeBaslat"
        @etiketYazdir="etiketYazdir"
      />
    </div>

    <!-- YENİ ÜRÜN EKLE DIALOG -->
    <v-dialog v-model="dialogs.create" max-width="600px" persistent>
      <v-card class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="primary" class="mr-2">mdi-plus-box</v-icon>
          {{ $t('products.yeniKuyumcuUrunuKaydet') }}
        </v-card-title>
        <v-card-text>
          <ProductForm @urunEklendi="urunKaydet" />
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" @click="dialogs.create = false">{{ $t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <ProductEditDialog
      v-model="dialogs.edit"
      :product="selected"
      :categories="categories"
      :materials="materials"
      @saved="replaceProduct"
    />
    <BarcodeCameraDialog v-model="dialogs.camera" @detected="onBarcodeDetected" />
    <CategoryManagerDialog v-model="dialogs.categories" v-model:categories="categories" />
  </div>
</template>

<script>
import { money, t } from '@/i18n';
import apiService from '@/services/api';
import { confirmAction } from '@/services/confirm';
import { errorMessage } from '@/services/finance';
import { printLabel } from '@/services/labels';
import { isCriticalStock } from '@/services/stockLevels';
import ProductForm from './ProductForm.vue';
import ProductList from './ProductList.vue';
import ProductEditDialog from '@/components/products/ProductEditDialog.vue';
import BarcodeCameraDialog from '@/components/products/BarcodeCameraDialog.vue';
import CategoryManagerDialog from '@/components/products/CategoryManagerDialog.vue';

/** Catalogue and stock: list, filters, KPIs; editing and scanning live in dialog components. */
export default {
  name: 'ProductPage',
  components: { ProductForm, ProductList, ProductEditDialog, BarcodeCameraDialog, CategoryManagerDialog },
  data() {
    return {
      search: '',
      categoryFilter: '',
      stockFilter: '',
      urunler: [],
      loading: false,
      error: '',
      selected: null,
      categories: [],
      materials: [],
      dialogs: { create: false, edit: false, camera: false, categories: false },
    };
  },
  computed: {
    totalStockQuantity() {
      return this.urunler.reduce((sum, u) => sum + (Number(u.stock) || 0), 0);
    },
    totalWeight() {
      return this.urunler.reduce((sum, u) => sum + (Number(u.weight) || 0) * (Number(u.stock) || 1), 0);
    },
    lowStockCount() {
      return this.urunler.filter((u) => isCriticalStock(u.stock, this.$store.state.settings.lowStockThreshold)).length;
    },
  },
  mounted() {
    this.fetchProducts();
    this.fetchReference('/api/categories', 'categories');
    this.fetchReference('/api/materials', 'materials');
  },
  methods: {
    async fetchProducts() {
      this.loading = true;
      this.error = '';
      try {
        const data = await apiService.get('/api/products');
        this.urunler = (data || []).filter((p) => !p.isArchived);
      } catch (err) {
        this.error = err.message || t('products.loadFailed');
      } finally {
        this.loading = false;
      }
    },
    async fetchReference(endpoint, key) {
      try {
        this[key] = (await apiService.get(endpoint)) || [];
      } catch {
        this[key] = [];
      }
    },
    async urunKaydet(yeni) {
      try {
        const created = await apiService.post('/api/products', yeni);
        this.urunler.unshift(created);
        this.dialogs.create = false;
        this.$store.dispatch('notifications/showSuccess', t('products.yeniUrunKatalogaEklendi'));
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('products.urunEklenemediP0', { p0: errorMessage(err) }));
      }
    },
    async urunSil(id) {
      const ok = await confirmAction({
        title: t('products.urunuArsivleSil'),
        message: t('products.buUrunuKatalogdanKaldirmakIstediginize'),
        confirmLabel: t('products.katalogdanKaldir'),
        tone: 'danger',
      });
      if (!ok) return;
      try {
        await apiService.delete(`/api/products/${id}`);
        this.urunler = this.urunler.filter((u) => u._id !== id);
        this.$store.dispatch('notifications/showSuccess', t('products.urunArsivlendi'));
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('products.silmeHatasiP0', { p0: errorMessage(err) }));
      }
    },
    duzenlemeBaslat(urun) {
      this.selected = urun;
      this.dialogs.edit = true;
    },
    replaceProduct(updated) {
      const index = this.urunler.findIndex((u) => u._id === updated._id);
      if (index !== -1) this.urunler.splice(index, 1, updated);
    },
    onBarcodeDetected(code) {
      this.search = code;
      this.$store.dispatch('notifications/showSuccess', t('products.barkodBulundu', { code }));
    },
    /** Prints a Code 128 shelf/tag label (name, price, barcode). */
    etiketYazdir(urun) {
      const result = printLabel(urun, (value) => money(value));
      if (result.ok) return;
      if (result.reason === 'no_code') this.$store.dispatch('notifications/showWarning', t('products.etiketKoduYok'));
      else this.$store.dispatch('notifications/showError', t('products.etiketKoduGecersiz', { code: result.code }));
    },
  },
};
</script>

<style scoped>
.products-page-shell {
  height: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  gap: 8px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* KPI Ribbon */
.inventory-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  flex-shrink: 0;
}

/* Main Products Card */
.products-main-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 8px 12px;
}

/* Toolbar */
.products-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--jp-border);
  flex-shrink: 0;
}

.search-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  width: 280px;
}

.search-icon {
  color: var(--jp-text-subtle);
}

.products-search-field {
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--jp-text);
  font-size: 11px;
  width: 100%;
}
.products-search-field::placeholder {
  color: var(--jp-text-subtle);
}

.filter-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.compact-select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  color: var(--jp-text);
  font-size: 11px;
  outline: none;
}
.compact-select:focus {
  border-color: var(--jp-gold);
}

.record-counter {
  font-size: 11px;
  color: var(--jp-text-subtle);
  margin-left: 6px;
}

.dialog-header {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--jp-border);
}

.dialog-actions {
  padding: 10px 14px;
  border-top: 1px solid var(--jp-border);
}

@keyframes scan {
  0%, 100% { transform: translateY(-40px); }
  50% { transform: translateY(40px); }
}

@media (max-width: 900px) {
  .inventory-kpi-row {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
