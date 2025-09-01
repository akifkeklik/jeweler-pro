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
    <template v-slot:item.fiyat="{ item }">
      <!-- Eğer 'fiyat' varsa onu kullan, yoksa 'price' -->
      {{ (item.fiyat || item.price).toLocaleString() }} ₺
    </template>

    <!-- Ürün adı -->
    <template v-slot:item.ad="{ item }">
      {{ item.ad || item.name }}
    </template>

    <!-- İşlemler -->
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
  data() {
    return {
      headers: [
        { text: "ID", value: "_id" },
        { text: "Ürün Adı", value: "ad" },       // ad || name
        { text: "Gram", value: "weight" },         // sadece bazı kayıtlarda var
        { text: "Fiyat", value: "price" },       // fiyat || price
        { text: "Barkod", value: "barcode" },     // sadece bazı kayıtlarda var
        { text: "Açıklama", value: "description" }, // çoğunda description var
        { text: "İşlemler", value: "actions", sortable: false }
      ]
    };
  }
};
</script>
