<template>
  <form class="product-form-container" @submit.prevent="submitForm">
    <div class="form-grid-2">
      <div class="form-col-span-2">
        <label class="form-label">{{ $t('products.urunAdi') }}</label>
        <input
          v-model.trim="urun.name"
          type="text"
          :placeholder="$t('products.orn22AyarBurmaBilezik')"
          class="form-input-control"
          required
        />
      </div>

      <div>
        <label class="form-label">{{ $t('products.kategori2') }}</label>
        <select v-model="urun.categoryId" class="form-select-control" required>
          <option value="" disabled>{{ $t('products.kategoriSecin') }}</option>
          <option v-for="c in categories" :key="c._id" :value="c._id">
            {{ c.name }}
          </option>
        </select>
      </div>

      <div>
        <label class="form-label">{{ $t('products.hammaddeMaden') }}</label>
        <select v-model="urun.materialId" class="form-select-control" required>
          <option value="" disabled>{{ $t('products.madenSecin') }}</option>
          <option v-for="m in materials" :key="m._id" :value="m._id">
            {{ m.name }}
          </option>
        </select>
      </div>

      <div>
        <label class="form-label">{{ $t('products.gramAgirlik') }}</label>
        <input
          v-model.number="urun.weight"
          type="number"
          step="0.001"
          min="0.001"
          :placeholder="$t('products.orn1550')"
          class="form-input-control tabular"
          required
        />
      </div>

      <div>
        <label class="form-label">{{ $t('products.stokAdedi') }}</label>
        <input
          v-model.number="urun.stock"
          type="number"
          min="0"
          :placeholder="$t('products.orn10')"
          class="form-input-control tabular"
          required
        />
      </div>

      <div>
        <label class="form-label">{{ $t('products.birimMaliyet') }}</label>
        <input
          v-model.number="urun.costPrice"
          type="number"
          step="0.01"
          min="0"
          :placeholder="$t('products.orn28000')"
          class="form-input-control tabular"
        />
      </div>

      <div>
        <label class="form-label">{{ urun.pricingMode === 'gram' ? $t('products.listeFiyatiBilgiAmacli') : $t('products.satisFiyati') }}</label>
        <input
          v-model.number="urun.price"
          type="number"
          step="0.01"
          min="0"
          :placeholder="$t('products.orn32500')"
          class="form-input-control tabular"
          :required="urun.pricingMode !== 'gram'"
        />
      </div>
      <div class="form-col-span-2">
        <label class="form-label">{{ $t('products.fiyatlandirma') }}</label>
        <select v-model="urun.pricingMode" class="form-select-control">
          <option value="fixed">{{ $t('products.sabitFiyatAdet') }}</option>
          <option value="gram">{{ $t('products.gramFiyatiSatisAnindaCanli') }}</option>
        </select>
      </div>
      <template v-if="urun.pricingMode === 'gram'">
        <div>
          <label class="form-label">{{ $t('products.ayar') }}</label>
          <select v-model.number="urun.karat" class="form-select-control">
            <option v-for="o in purityOptions" :key="o.karat" :value="o.karat">{{ o.label }}</option>
          </select>
        </div>
        <div>
          <label class="form-label">{{ $t('products.iscilik') }}</label>
          <div class="labor-pair">
            <select v-model="urun.laborType" class="form-select-control">
              <option value="none">{{ $t('products.yok') }}</option>
              <option value="milyem">{{ $t('products.milyem') }}</option>
              <option value="per_gram">{{ $t('products.tlGram') }}</option>
              <option value="fixed">{{ $t('products.tlAdet') }}</option>
            </select>
            <input
              v-model.trim="urun.laborValue"
              type="text"
              inputmode="decimal"
              :disabled="urun.laborType === 'none'"
              placeholder="0"
              class="form-input-control tabular"
            />
          </div>
        </div>
      </template>

      <div class="form-col-span-2">
        <label class="form-label">{{ $t('products.barkod') }}</label>
        <input
          v-model.trim="urun.barcode"
          type="text"
          :placeholder="$t('products.barkodNumarasiOpsiyonel')"
          class="form-input-control tabular"
        />
      </div>

      <div class="form-col-span-2">
        <label class="form-label">{{ $t('products.urunAciklamasiNotlar') }}</label>
        <textarea
          v-model.trim="urun.description"
          rows="2"
          :placeholder="$t('products.urunIsciligiTasBilgisiVeya')"
          class="form-textarea-control"
        ></textarea>
      </div>
    </div>

    <div class="form-actions mt-4">
      <v-spacer></v-spacer>
      <v-btn
        size="small"
        type="submit"
        class="jp-primary"
        :disabled="!isValid"
      >
        <v-icon start size="14">mdi-check</v-icon>
        {{ $t('products.urunuKaydet') }}
      </v-btn>
    </div>
  </form>
</template>

<script>
import apiService from "@/services/api";
import { normalizeDecimalInput, PURITY_OPTIONS } from "@/services/finance";

function emptyProduct() {
  return {
    name: "",
    categoryId: "",
    materialId: "",
    weight: "",
    price: "",
    costPrice: "",
    barcode: "",
    description: "",
    stock: "",
    pricingMode: "fixed",
    karat: 22,
    laborType: "none",
    laborValue: "",
  };
}

export default {
  name: "ProductForm",
  data() {
    return {
      urun: emptyProduct(),
      purityOptions: PURITY_OPTIONS,
      categories: [],
      materials: []
    };
  },
  computed: {
    isValid() {
      return (
        Boolean(this.urun.name) &&
        Boolean(this.urun.categoryId) &&
        Boolean(this.urun.materialId) &&
        Number(this.urun.weight) > 0 &&
        (this.urun.pricingMode === 'gram' || Number(this.urun.price) > 0) &&
        Number(this.urun.stock) >= 0
      );
    }
  },
  mounted() {
    this.fetchCategories();
    this.fetchMaterials();
  },
  methods: {
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
    submitForm() {
      if (!this.isValid) return;
      this.$emit("urunEklendi", {
        name: this.urun.name,
        categoryId: this.urun.categoryId,
        materialId: this.urun.materialId,
        weight: Number(this.urun.weight),
        price: this.urun.price === "" || this.urun.price === null ? undefined : Number(this.urun.price),
        costPrice: this.urun.costPrice === "" || this.urun.costPrice === null ? null : Number(this.urun.costPrice),
        barcode: this.urun.barcode ? this.urun.barcode : undefined,
        description: this.urun.description,
        stock: Number(this.urun.stock),
        pricingMode: this.urun.pricingMode,
        ...(this.urun.pricingMode === 'gram' ? {
          metal: 'XAU',
          karat: this.urun.karat,
          laborType: this.urun.laborType,
          laborValue: this.urun.laborType === 'none' ? '0' : (normalizeDecimalInput(this.urun.laborValue) || '0'),
        } : {}),
      });
      this.urun = emptyProduct();
    }
  }
};
</script>

<style scoped>
.product-form-container {
  display: flex;
  flex-direction: column;
}

.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.form-col-span-2 {
  grid-column: span 2;
}

.labor-pair {
  display: grid;
  grid-template-columns: 1fr 90px;
  gap: 6px;
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

.form-input-control,
.form-select-control {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  color: var(--jp-text-emphasis);
  font-size: 11px;
  outline: none;
  transition: border-color var(--jp-motion-fast) var(--jp-ease-standard);
}

.form-input-control:focus,
.form-select-control:focus {
  border-color: var(--jp-gold);
}

.form-textarea-control {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  color: var(--jp-text-emphasis);
  font-size: 11px;
  outline: none;
  resize: vertical;
}
.form-textarea-control:focus {
  border-color: var(--jp-gold);
}

.form-actions {
  display: flex;
  align-items: center;
}
</style>
