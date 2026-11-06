<template>
  <v-data-table
      :headers="headers"
      :items="urunler"
      :search="search"
      class="elevation-1"
      dense
      hide-default-footer
      :items-per-page="10"
  >
    <!-- Fiyat kolonunu ₺ ile formatla -->
    <template v-slot:item.price="{ item }">
      <!-- Eğer 'fiyat' varsa onu kullan, yoksa 'price' -->
      {{ money(item.fiyat !== undefined ? item.fiyat : item.price) }}
    </template>

    <!-- Ürün adı -->
    <template v-slot:item.ad="{ item }">
      {{ item.ad || item.name }}
    </template>

    <template v-slot:item.weight="{ item }">
      <span class="numeric-cell">{{ item.weight !== undefined && item.weight !== null ? Number(item.weight).toLocaleString("tr-TR", { maximumFractionDigits: 3 }) + " g" : "—" }}</span>
    </template>
    <template v-slot:item.stock="{ item }">
      <span class="stock-pill" :class="Number(item.stock) > 0 ? 'stock-ok' : 'stock-empty'">{{ item.stock !== undefined ? item.stock : "—" }}</span>
    </template>
    <template v-slot:item.actions="{ item }">
      <v-tooltip top>
        <template v-slot:activator="{ on, attrs }">
          <v-btn icon small v-bind="attrs" v-on="on" @click="$emit('urunDuzenle', item)">
            <v-icon color="blue">mdi-pencil</v-icon>
          </v-btn>
        </template>
        <span>Düzenle</span>
      </v-tooltip>

      <v-tooltip top>
        <template v-slot:activator="{ on, attrs }">
          <v-btn icon small v-bind="attrs" v-on="on" @click="$emit('urunSil', item._id)">
            <v-icon color="red">mdi-delete</v-icon>
          </v-btn>
        </template>
        <span>Sil</span>
      </v-tooltip>
    </template>
  </v-data-table>
</template>

<script>
export default {
  props: {
    urunler: Array,
    search: String
  },
  methods: {
    money(value) {
      const amount = Number(value);
      return Number.isFinite(amount)
        ? new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(amount)
        : "—";
    }
  },
  data() {
    return {
      headers: [
        { text: "ID", value: "_id" },
        { text: "Ürün Adı", value: "ad" },       // ad || name
        { text: "Gram", value: "weight" },         // sadece bazı kayıtlarda var
        { text: "Fiyat", value: "price" },       // fiyat || price
        { text: "Barkod", value: "barcode" },
        { text: "Stok", value: "stock", align: "end", width: 85 },
        { text: "İşlemler", value: "actions", sortable: false, align: "end", width: 110 }
      ]
    };
  }
};
</script>

<style scoped>
.numeric-cell { color:#c4d0e0; font-variant-numeric:tabular-nums; }
.stock-pill { display:inline-flex; min-width:28px; justify-content:center; padding:4px 7px; border-radius:5px; font-size:10px; font-weight:700; }
.stock-ok { color:#64d7a8; background:rgba(43,190,137,.12); }
.stock-empty { color:#f0b66a; background:rgba(225,161,60,.12); }
</style>
