<template>
  <v-card class="pa-4 mb-4 elevation-2" style="border-radius: 12px;">
    <v-form v-model="formValid" @submit.prevent="submitForm" ref="urunForm">
      <v-text-field v-model="urun.name" label="Ürün Adı" outlined dense :rules="[v => !!v || 'Ürün adı zorunlu']"/>

      <!-- Kategori seçimi (ID ile) -->
      <v-select
          :menu-props="{offsetY:true}"
          v-model="urun.categoryId"
          :items="categories"
          item-text="name"
          item-value="_id"
          label="Kategori"
          outlined
          dense
          :rules="[v => !!v || 'Kategori seçiniz']"
      />

      <!-- Hammadde seçimi (ID ile) -->
      <v-select
          :menu-props="{offsetY:true}"
          v-model="urun.materialId"
          :items="materials"
          item-text="name"
          item-value="_id"
          label="Hammadde"
          outlined
          dense
          :rules="[v => !!v || 'Hammadde seçiniz']"
      />

      <v-text-field v-model="urun.weight" type="number" label="Gram" outlined dense :rules="[v => v > 0 || 'Gram > 0 olmalı']"/>
      <v-text-field v-model="urun.price" type="number" label="Fiyat (₺)" outlined dense :rules="[v => v > 0 || 'Fiyat > 0 olmalı']"/>
      <v-text-field v-model="urun.barcode" label="Barkod" outlined dense />
      <v-text-field v-model="urun.description" label="Açıklama" outlined dense />
      <v-text-field v-model="urun.stock" type="number" label="Stok" outlined dense :rules="[v => v >= 0 || 'Stok 0 veya üstü olmalı']"/>

      <v-btn type="submit" color="primary" class="mt-3" :disabled="!formValid">
        Kaydet
      </v-btn>
    </v-form>
  </v-card>
</template>

<script>
import axios from "axios";

export default {
  data() {
    return {
      urun: {
        name: "",
        categoryId: "",
        materialId: "",
        weight: "",
        price: "",
        barcode: "",
        description: "",
        stock: ""
      },
      categories: [],  // backend'den kategori listesi gelecek
      materials: [],   // backend'den hammadde listesi gelecek
      formValid: false
    };
  },
  mounted() {
    this.fetchCategories();
    this.fetchMaterials();
  },
  methods: {
    async fetchCategories() {
      const res = await axios.get("http://localhost:5000/api/categories");
      this.categories = res.data;
    },
    async fetchMaterials() {
      const res = await axios.get("http://localhost:5000/api/materials");
      this.materials = res.data;
    },
    submitForm() {
      if (this.$refs.urunForm.validate()) {
        this.$emit("urunEklendi", { ...this.urun });
        this.urun = { name: "", categoryId: "", materialId: "", weight: "", price: "", barcode: "", description: "", stock: "" };
        this.$refs.urunForm.resetValidation();
      }
    }
  }
};
</script>
