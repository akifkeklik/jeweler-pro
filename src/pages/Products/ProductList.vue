<template>
  <div class="product-table-wrapper">
    <table class="jp-enterprise-table">
      <thead>
        <tr>
          <th style="width: 90px;">{{ $t('products.kodId') }}</th>
          <th>{{ $t('products.urunAdiDetay') }}</th>
          <th style="width: 110px;">{{ $t('products.barkod') }}</th>
          <th class="text-right" style="width: 100px;">{{ $t('products.agirlik') }}</th>
          <th class="text-right" style="width: 120px;">{{ $t('products.birimMaliyet2') }}</th>
          <th class="text-right" style="width: 130px;">{{ $t('products.satisFiyati2') }}</th>
          <th class="text-center" style="width: 110px;">{{ $t('products.stokDurumu') }}</th>
          <th class="text-center" style="width: 90px;">{{ $t('products.islemler') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in filteredProducts" :key="item._id">
          <td class="tabular text-disabled text-caption font-weight-bold">
            #{{ item._id }}
          </td>
          <td>
            <div class="product-name-cell">
              <span class="product-title">{{ item.ad || item.name }}</span>
              <span v-if="item.description" class="product-desc">{{ item.description }}</span>
            </div>
          </td>
          <td>
            <span v-if="item.barcode" class="barcode-tag tabular">{{ item.barcode }}</span>
            <span v-else class="text-disabled text-caption">—</span>
          </td>
          <td class="text-right tabular font-weight-medium">
            <span v-if="item.weight" class="weight-badge">{{ $weight(item.weight) }}</span>
            <span v-else class="text-disabled">—</span>
          </td>
          <td class="text-right tabular text-disabled">
            {{ item.costPrice ? money(item.costPrice) : '—' }}
          </td>
          <td class="text-right tabular font-weight-bold text-success">
            <!-- Gram-priced items have no fixed price: it is computed at sale time. -->
            <span v-if="item.pricingMode === 'gram'" class="gram-price" :title="$t('products.gramFiyatiSatisAnindaCanli')">{{ $t('products.canliGram') }}</span>
            <template v-else>{{ money(item.fiyat || item.price) }}</template>
          </td>
          <td class="text-center">
            <span class="jp-badge" :class="stockBadgeClass(item.stock)">
              {{ item.stock > 0 ? `${$n(item.stock)} ${$t('units.piece')}` : $t('products.tukendi') }}
            </span>
          </td>
          <td class="text-center">
            <div class="table-actions">
              <v-btn
                icon
                size="x-small"
                variant="text"
                color="warning"
                :title="$t('products.urunDuzenle')"
                @click="$emit('urunDuzenle', item)"
              >
                <v-icon size="15">mdi-pencil-outline</v-icon>
              </v-btn>
              <v-btn
                icon
                size="x-small"
                variant="text"
                color="info"
                :title="$t('products.etiketYazdir')"
                :aria-label="$t('products.etiketYazdir')"
                @click="$emit('etiketYazdir', item)"
              >
                <v-icon size="15">mdi-barcode</v-icon>
              </v-btn>
              <v-btn
                v-if="$can('catalog:delete')"
                icon
                size="x-small"
                variant="text"
                color="error"
                :title="$t('products.urunArsivleSil')"
                @click="$emit('urunSil', item._id)"
              >
                <v-icon size="15">mdi-delete-outline</v-icon>
              </v-btn>
            </div>
          </td>
        </tr>
        <tr v-if="!filteredProducts.length">
          <td colspan="8" class="empty-state-cell">
            <v-icon size="32" class="mb-2 jp-empty-icon">mdi-cube-off-outline</v-icon>
            <div>{{ $t('products.aramaKriterinizeUygunUrunKaydi') }}</div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script>
import { money, normalizeSearch } from '@/i18n';
import { stockLevel } from '@/services/stockLevels';
export default {
  name: "ProductList",
  props: {
    urunler: {
      type: Array,
      default: () => []
    },
    search: {
      type: String,
      default: ""
    },
    categoryFilter: {
      type: [String, Number],
      default: ""
    },
    stockFilter: {
      type: String,
      default: ""
    }
  },
  computed: {
    lowStockThreshold() {
      return this.$store.state.settings.lowStockThreshold;
    },
    filteredProducts() {
      const q = normalizeSearch(this.search).trim();
      return (this.urunler || []).filter((item) => {
        const nameMatch = normalizeSearch(item.ad || item.name).includes(q);
        const barcodeMatch = normalizeSearch(item.barcode).includes(q);
        const idMatch = String(item._id || "").includes(q);
        const matchesSearch = !q || nameMatch || barcodeMatch || idMatch;

        let matchesCategory = true;
        if (this.categoryFilter) {
          const catId = item.categoryId && typeof item.categoryId === "object" ? item.categoryId._id : item.categoryId;
          matchesCategory = String(catId) === String(this.categoryFilter);
        }

        let matchesStock = true;
        // Buckets of the shared rule (src/services/stockLevels.ts): out / low / ok.
        const level = stockLevel(item.stock, this.lowStockThreshold);
        if (this.stockFilter === "low") {
          matchesStock = level === "low";
        } else if (this.stockFilter === "out") {
          matchesStock = level === "out";
        } else if (this.stockFilter === "in") {
          matchesStock = level === "ok";
        }

        return matchesSearch && matchesCategory && matchesStock;
      });
    }
  },
  methods: {
    money(val) {
      return money(Number(val) || 0);
    },
    stockBadgeClass(stock) {
      const level = stockLevel(stock, this.lowStockThreshold);
      if (level === "out") return "jp-badge-danger";
      if (level === "low") return "jp-badge-warning";
      return "jp-badge-success";
    }
  }
};
</script>

<style scoped>
.product-table-wrapper {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: auto;
}

.jp-enterprise-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.jp-enterprise-table thead th {
  position: sticky;
  top: 0;
  background: var(--jp-surface-muted);
  color: var(--jp-text-subtle);
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--jp-border);
  z-index: 2;
  white-space: nowrap;
}

.jp-enterprise-table tbody td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--jp-border-soft);
  color: var(--jp-text);
  white-space: nowrap;
}

.jp-enterprise-table tbody tr:hover {
  background: var(--jp-surface-card-hover);
}

.product-name-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.product-title {
  color: var(--jp-text-emphasis);
  font-weight: 600;
}

.product-desc {
  font-size: 9px;
  color: var(--jp-text-subtle);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.barcode-tag {
  font-size: 10px;
  padding: 1px 5px;
  background: var(--jp-border-soft);
  border: 1px solid var(--jp-border);
  border-radius: 3px;
  color: var(--jp-text-muted);
}

.gram-price {
  font-size: 11px;
  font-weight: 600;
  color: var(--jp-warning, #c9a227);
}
.weight-badge {
  color: var(--jp-gold);
  background: var(--jp-gold-subtle);
  border: 1px solid var(--jp-gold-border);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 10px;
}

.table-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.empty-state-cell {
  text-align: center;
  padding: 36px 12px;
  color: var(--jp-text-muted);
}
</style>
