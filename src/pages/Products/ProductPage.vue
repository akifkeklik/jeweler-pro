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
          @click="kameraDialog = true"
        >
          <v-icon start size="14">mdi-barcode-scan</v-icon>
          {{ $t('products.barkodTara') }}
        </v-btn>
        <v-btn
          size="small"
          class="jp-secondary"
          @click="kategoriDialog = true"
        >
          <v-icon start size="14">mdi-shape-outline</v-icon>
          {{ $t('products.kategoriler') }}
        </v-btn>
        <v-btn
          size="small"
          class="jp-primary"
          @click="yeniUrunDialog = true"
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
          <select v-model="categoryFilter" class="compact-select">
            <option value="">{{ $t('products.tumKategoriler') }}</option>
            <option v-for="c in categories" :key="c._id" :value="c._id">
              {{ c.name }}
            </option>
          </select>

          <select v-model="stockFilter" class="compact-select">
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
    <v-dialog v-model="yeniUrunDialog" max-width="600px" persistent>
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
          <v-btn size="small" class="jp-secondary" @click="yeniUrunDialog = false">{{ $t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ÜRÜN DÜZENLE DIALOG -->
    <v-dialog v-model="duzenleDialog" max-width="600px" persistent>
      <v-card class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="warning" class="mr-2">mdi-pencil</v-icon>
          {{ $t('products.urunDuzenleP0', { p0: seciliUrun._id }) }}
        </v-card-title>
        <v-card-text>
          <form class="edit-form-grid" @submit.prevent="duzenlemeKaydet">
            <div class="col-span-2">
              <label class="form-label">{{ $t('products.urunAdi') }}</label>
              <input v-model.trim="seciliUrun.name" type="text" class="form-input-full" required />
            </div>

            <div>
              <label class="form-label">{{ $t('products.kategori') }}</label>
              <select v-model="seciliUrun.categoryId" class="form-select-full">
                <option v-for="c in categories" :key="c._id" :value="c._id">{{ c.name }}</option>
              </select>
            </div>

            <div>
              <label class="form-label">{{ $t('products.hammadde') }}</label>
              <select v-model="seciliUrun.materialId" class="form-select-full">
                <option v-for="m in materials" :key="m._id" :value="m._id">{{ m.name }}</option>
              </select>
            </div>

            <div>
              <label class="form-label">{{ $t('products.agirlikGram') }}</label>
              <input v-model.number="seciliUrun.weight" type="number" step="0.01" min="0.01" class="form-input-full tabular" required />
            </div>

            <div>
              <label class="form-label">{{ $t('products.stokAdedi') }} <span v-if="!$can('inventory:adjust')" class="text-disabled">{{ $t('products.degisiklikIcinYetkiGerekir') }}</span></label>
              <input v-model.number="seciliUrun.stock" type="number" min="0" class="form-input-full tabular" :disabled="!$can('inventory:adjust')" required />
            </div>

            <div>
              <label class="form-label">{{ $t('products.birimMaliyet') }}</label>
              <input v-model.number="seciliUrun.costPrice" type="number" step="0.01" min="0" class="form-input-full tabular" :disabled="!$can('inventory:adjust')" />
            </div>

            <div>
              <label class="form-label">{{ seciliUrun.pricingMode === 'gram' ? $t('products.listeFiyatiSatistaCanliGram') : $t('products.satisFiyati') }}</label>
              <input v-model.number="seciliUrun.price" type="number" step="0.01" min="0" class="form-input-full tabular" :required="seciliUrun.pricingMode !== 'gram'" />
              <p v-if="$can('inventory:adjust')" class="text-caption text-disabled mt-1">{{ $t('products.stokVeyaMaliyetDegisikligiGerekcesiyle') }}</p>
            </div>

            <div class="col-span-2">
              <label class="form-label">{{ $t('products.barkod') }}</label>
              <input v-model.trim="seciliUrun.barcode" type="text" class="form-input-full tabular" />
            </div>

            <div class="col-span-2">
              <label class="form-label">{{ $t('common.description') }}</label>
              <textarea v-model.trim="seciliUrun.description" rows="2" class="form-textarea-full"></textarea>
            </div>
          </form>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" @click="duzenleDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn size="small" class="jp-primary" @click="duzenlemeKaydet">{{ $t('common.saveChanges') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- SİLME / ARŞİV ONAY DIALOG -->
    <v-dialog v-model="deleteDialog" max-width="420px">
      <v-card class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="error" class="mr-2">mdi-alert-circle</v-icon>
          {{ $t('products.urunuArsivleSil') }}
        </v-card-title>
        <v-card-text class="text-caption">
          {{ $t('products.buUrunuKatalogdanKaldirmakIstediginize') }}
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" @click="deleteDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn size="small" class="jp-btn-danger" @click="confirmDelete">{{ $t('products.katalogdanKaldir') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- BARKOD TARA KAMERA MODAL -->
    <v-dialog v-model="kameraDialog" max-width="500px">
      <v-card class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="info" class="mr-2">mdi-camera</v-icon>
          {{ $t('products.kameraIleBarkodTara') }}
        </v-card-title>
        <v-card-text>
          <div class="camera-stream-wrap">
            <video ref="video" autoplay playsinline class="camera-video"></video>
            <div class="scanner-laser"></div>
          </div>
          <p v-if="kameraDesteklenmiyor" class="text-caption text-center mt-2" role="alert">
            {{ $t('products.kameraDesteklenmiyor') }}
          </p>
          <p v-else class="text-caption text-center text-disabled mt-2">
            {{ $t('products.barkoduKameraninGorusAlaninaHizalayin') }}
          </p>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" @click="kameraDialog = false">{{ $t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- KATEGORİ YÖNETİMİ DIALOG -->
    <v-dialog v-model="kategoriDialog" max-width="500px">
      <v-card class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="primary" class="mr-2">mdi-shape-outline</v-icon>
          {{ $t('products.urunKategorileriYonetimi') }}
        </v-card-title>
        <v-card-text>
          <!-- Yeni Kategori Ekleme Formu -->
          <div class="d-flex gap-2 align-center mb-3">
            <input
              v-model.trim="yeniKategoriAdi"
              type="text"
              :placeholder="$t('products.yeniKategoriAdiOrnPirlanta')"
              class="form-input-full"
              @keydown.enter.prevent="kategoriEkle"
            />
            <v-btn
              size="small"
              class="jp-primary ml-2"
              :disabled="!yeniKategoriAdi"
              :loading="kategoriEkleniyor"
              @click="kategoriEkle"
            >
              {{ $t('common.add') }}
            </v-btn>
          </div>

          <!-- Kategori Listesi -->
          <div class="table-scroll-wrap" style="max-height: 250px;">
            <table class="jp-enterprise-table">
              <thead>
                <tr>
                  <th>{{ $t('products.kategoriAdi') }}</th>
                  <th class="text-center" style="width: 70px;">{{ $t('products.islem') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="cat in categories" :key="cat._id">
                  <td class="font-weight-medium text-white">{{ cat.name }}</td>
                  <td class="text-center">
                    <v-btn
                      v-if="$can('catalog:delete')"
                      icon
                      size="x-small"
                      variant="text"
                      color="error"
                      :title="$t('products.kategoriyiSil')"
                      @click="kategoriSil(cat._id)"
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
          <v-btn size="small" class="jp-secondary" @click="kategoriDialog = false">{{ $t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { money, t } from '@/i18n';
import { code128Svg } from '@/services/barcode';
import { escapeHtml, printDocument } from '@/services/print';
import apiService from "@/services/api";
import ProductForm from "./ProductForm.vue";
import ProductList from "./ProductList.vue";
import { isCriticalStock } from "@/services/stockLevels";

export default {
  name: "ProductPage",
  components: { ProductForm, ProductList },
  data() {
    return {
      search: "",
      categoryFilter: "",
      stockFilter: "",
      kameraDialog: false,
      kameraDesteklenmiyor: false,
      kategoriDialog: false,
      yeniKategoriAdi: "",
      kategoriEkleniyor: false,
      urunler: [],
      loading: false,
      error: "",
      duzenleDialog: false,
      yeniUrunDialog: false,
      deleteDialog: false,
      seciliUrun: {},
      urunSilId: null,
      videoStream: null,
      categories: [],
      materials: []
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
    }
  },
  mounted() {
    this.fetchProducts();
    this.fetchCategories();
    this.fetchMaterials();
  },
  methods: {
    async fetchProducts() {
      this.loading = true;
      this.error = "";
      try {
        const data = await apiService.get("/api/products");
        this.urunler = (data || []).filter((p) => !p.isArchived);
      } catch (err) {
        this.error = err.message || t('products.loadFailed');
      } finally {
        this.loading = false;
      }
    },
    async fetchCategories() {
      try {
        this.categories = await apiService.get("/api/categories");
      } catch (err) {
        this.categories = [];
      }
    },
    async fetchMaterials() {
      try {
        this.materials = await apiService.get("/api/materials");
      } catch (err) {
        this.materials = [];
      }
    },
    async kategoriEkle() {
      if (!this.yeniKategoriAdi) return;
      this.kategoriEkleniyor = true;
      try {
        const created = await apiService.post("/api/categories", { name: this.yeniKategoriAdi });
        this.categories.push(created);
        this.yeniKategoriAdi = "";
        this.$store.dispatch('notifications/showSuccess', t('products.yeniKategoriBasariylaEklendi'));
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('products.kategoriEklenemediP0', { p0: (err.response?.data?.message || err.message) }));
      } finally {
        this.kategoriEkleniyor = false;
      }
    },
    async kategoriSil(id) {
      try {
        await apiService.delete("/api/categories/" + id);
        this.categories = this.categories.filter((c) => c._id !== id);
        this.$store.dispatch('notifications/showSuccess', t('products.kategoriSilindi'));
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('products.kategoriSilinemediP0', { p0: (err.response?.data?.message || err.message) }));
      }
    },
    async urunKaydet(yeni) {
      try {
        const created = await apiService.post("/api/products", yeni);
        this.urunler.unshift(created);
        this.yeniUrunDialog = false;
        this.$store.dispatch('notifications/showSuccess', t('products.yeniUrunKatalogaEklendi'));
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('products.urunEklenemediP0', { p0: (err.response?.data?.message || err.message) }));
      }
    },
    urunSil(id) {
      this.urunSilId = id;
      this.deleteDialog = true;
    },
    async confirmDelete() {
      try {
        await apiService.delete("/api/products/" + this.urunSilId);
        this.urunler = this.urunler.filter((u) => u._id !== this.urunSilId);
        this.deleteDialog = false;
        this.$store.dispatch('notifications/showSuccess', t('products.urunArsivlendi'));
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('products.silmeHatasiP0', { p0: err.message }));
      }
    },
    duzenlemeBaslat(urun) {
      this.seciliUrun = {
        ...urun,
        categoryId: urun.categoryId && typeof urun.categoryId === 'object' ? urun.categoryId._id : urun.categoryId,
        materialId: urun.materialId && typeof urun.materialId === 'object' ? urun.materialId._id : urun.materialId,
      };
      this.duzenleDialog = true;
    },
    async duzenlemeKaydet() {
      const gram = this.seciliUrun.pricingMode === 'gram';
      if (!this.seciliUrun.name || (!gram && Number(this.seciliUrun.price) <= 0)) return;
      try {
        const payload = {
          name: this.seciliUrun.name,
          categoryId: this.seciliUrun.categoryId,
          materialId: this.seciliUrun.materialId,
          weight: Number(this.seciliUrun.weight),
          price: this.seciliUrun.price === '' || this.seciliUrun.price === null ? undefined : Number(this.seciliUrun.price),
          costPrice: this.seciliUrun.costPrice === "" || this.seciliUrun.costPrice === null ? null : Number(this.seciliUrun.costPrice),
          barcode: this.seciliUrun.barcode || undefined,
          description: this.seciliUrun.description,
          stock: Number(this.seciliUrun.stock)
        };
        const updated = await apiService.put("/api/products/" + this.seciliUrun._id, payload);
        const index = this.urunler.findIndex((u) => u._id === this.seciliUrun._id);
        if (index !== -1) {
          this.urunler.splice(index, 1, updated);
        }
        this.duzenleDialog = false;
        this.$store.dispatch('notifications/showSuccess', t('products.urunBasariylaGuncellendi'));
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('products.guncellemeHatasiP0', { p0: (err.response?.data?.message || err.message) }));
      }
    },
    /**
     * Camera scanning with the browser's BarcodeDetector (Chrome, Edge,
     * Android). Where it is missing the dialog says so instead of pretending
     * to scan; USB/Bluetooth scanners work everywhere (they type the code).
     */
    async startCamera() {
      this.kameraDesteklenmiyor = typeof window === 'undefined' || !('BarcodeDetector' in window)
        || !navigator.mediaDevices?.getUserMedia;
      if (this.kameraDesteklenmiyor) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        this.videoStream = stream;
        if (this.$refs.video) this.$refs.video.srcObject = stream;
        this.detector = new window.BarcodeDetector({ formats: ['code_128', 'ean_13', 'ean_8', 'upc_a', 'code_39', 'qr_code'] });
        this.scanFrame();
      } catch (error) {
        console.warn('Camera access failed:', error);
        this.kameraDesteklenmiyor = true;
      }
    },
    async scanFrame() {
      if (!this.kameraDialog || !this.detector || !this.$refs.video) return;
      try {
        const codes = await this.detector.detect(this.$refs.video);
        const code = codes?.[0]?.rawValue;
        if (code) {
          this.search = code;
          this.kameraDialog = false;
          this.$store.dispatch('notifications/showSuccess', t('products.barkodBulundu', { code }));
          return;
        }
      } catch {
        // The video may not be ready yet; try again on the next tick.
      }
      this.scanTimer = setTimeout(() => this.scanFrame(), 250);
    },
    stopCamera() {
      clearTimeout(this.scanTimer);
      this.detector = null;
      if (this.videoStream) {
        this.videoStream.getTracks().forEach((track) => track.stop());
        this.videoStream = null;
      }
    },
    /** Prints a Code 128 shelf/tag label (name, price, barcode). */
    etiketYazdir(urun) {
      const code = String(urun.barcode || urun.sku || '').trim();
      if (!code) {
        this.$store.dispatch('notifications/showWarning', t('products.etiketKoduYok'));
        return;
      }
      let svg;
      try {
        svg = code128Svg(code, { moduleWidth: 1.6, height: 48 });
      } catch {
        // Code 128 B covers printable ASCII only (no Turkish letters).
        this.$store.dispatch('notifications/showError', t('products.etiketKoduGecersiz', { code }));
        return;
      }
      const price = urun.pricingMode === 'gram' ? '' : money(urun.price);
      printDocument(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(urun.name)}</title>
<style>@page { size: 50mm 30mm; margin: 2mm; } body { margin: 0; font-family: system-ui, sans-serif; text-align: center; }
.n { font-size: 10px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .p { font-size: 11px; } svg { max-width: 100%; height: auto; }</style>
</head><body><div class="n">${escapeHtml(urun.name)}</div>${price ? `<div class="p">${escapeHtml(price)}</div>` : ''}${svg}</body></html>`);
    }
  },
  watch: {
    kameraDialog(newValue) {
      if (newValue) {
        this.$nextTick(() => this.startCamera());
      } else {
        this.stopCamera();
      }
    }
  }
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

/* Edit Form */
.edit-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.col-span-2 {
  grid-column: span 2;
}

.form-label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--jp-text-muted);
  margin-bottom: 4px;
}

.form-input-full,
.form-select-full {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  color: var(--jp-text-emphasis);
  font-size: 11px;
  outline: none;
}
.form-input-full:focus,
.form-select-full:focus {
  border-color: var(--jp-gold);
}

.form-textarea-full {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  color: var(--jp-text-emphasis);
  font-size: 11px;
  outline: none;
}
.form-textarea-full:focus {
  border-color: var(--jp-gold);
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

/* Camera scan stream */
.camera-stream-wrap {
  position: relative;
  width: 100%;
  height: 240px;
  background: #000;
  border-radius: var(--jp-radius-sm);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.camera-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scanner-laser {
  position: absolute;
  top: 50%;
  left: 10%;
  width: 80%;
  height: 2px;
  background: var(--jp-danger);
  box-shadow: 0 0 8px var(--jp-danger);
  animation: scan 2s infinite ease-in-out;
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
