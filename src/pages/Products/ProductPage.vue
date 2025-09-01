<template>
  <v-container fluid>
    <h2 class="mb-4">Ürün & Stok Yönetimi</h2>

    <!-- Ana Kart -->
    <v-card class="pa-6">
      <!-- Arama Kutusu -->
      <v-text-field
          v-model="search"
          placeholder="Ürün Ara (Ad / ID / Barkod)"
          prepend-inner-icon="mdi-magnify"
          outlined
          dense
          hide-details
          clearable
          class="search-bar mb-5 rounded-input"
      />

      <!-- Kamera ile Barkod Tara -->
      <v-btn color="primary" class="mb-5" @click="kameraDialog = true" block>
        <v-icon left>mdi-camera</v-icon>
        Barkod Tara
      </v-btn>

      <!-- Ürün Listesi -->
      <ProductList
          :urunler="urunler"
          :search="search"
          @urunSil="urunSil"
          @urunDuzenle="duzenlemeBaslat"
      />

      <!-- Yeni Ürün Ekle Butonu -->
      <v-btn color="primary" class="mt-5" @click="yeniUrunDialog = true" block>
        <v-icon left>mdi-plus</v-icon>
        Yeni Ürün Ekle
      </v-btn>
    </v-card>

    <!-- Ürün Ekleme Dialogu -->
    <v-dialog v-model="yeniUrunDialog" max-width="700px" transition="dialog-top-transition">
      <v-card>
        <v-card-title class="headline dialog-header">
          <v-icon left color="primary">mdi-plus</v-icon>
          Yeni Ürün Ekle
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text>
          <ProductForm ref="productForm" @urunEklendi="urunKaydet" />
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text color="grey" @click="yeniUrunDialog = false">Kapat</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Silme Onayı -->
    <v-dialog v-model="deleteDialog" max-width="500px">
      <v-card>
        <v-card-title class="headline delete-title">
          <span class="delete-text">Silmek istediğinize emin misiniz?</span>
        </v-card-title>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="warning" text @click="deleteDialog = false">İptal</v-btn>
          <v-btn color="red" text @click="confirmDelete">Sil</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Ürün Düzenleme Dialogu -->
    <v-dialog v-model="duzenleDialog" max-width="700px" transition="dialog-bottom-transition">
      <v-card>
        <v-card-title class="headline dialog-header">
          <v-icon left color="blue">mdi-pencil</v-icon>
          Ürün Düzenle
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text>
          <v-form ref="duzenleForm" v-model="duzenleFormValid">
            <v-text-field v-model="seciliUrun.name" label="Ürün Adı" outlined dense class="rounded-input" />
            <v-select
                v-model="seciliUrun.categoryId"
                :items="categories"
                item-text="name"
                item-value="_id"
                label="Kategori"
                outlined dense
                class="rounded-input"
            />
            <v-select
                v-model="seciliUrun.materialId"
                :items="materials"
                item-text="name"
                item-value="_id"
                label="Hammadde"
                outlined dense
                class="rounded-input"
            />
            <v-text-field v-model="seciliUrun.weight" type="number" label="Gram" outlined dense class="rounded-input" />
            <v-text-field v-model="seciliUrun.price" type="number" label="Fiyat (₺)" outlined dense class="rounded-input" />
            <v-text-field v-model="seciliUrun.barcode" label="Barkod" outlined dense class="rounded-input" />
            <v-text-field v-model="seciliUrun.description" label="Açıklama" outlined dense class="rounded-input" />
            <v-text-field v-model="seciliUrun.stock" type="number" label="Stok" outlined dense class="rounded-input" />
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="error" @click="duzenleDialog = false">İptal</v-btn>
          <v-btn color="primary" :disabled="!duzenleFormValid" @click="duzenlemeKaydet">Kaydet</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Kamera ile Barkod Okuma Dialogu -->
    <v-dialog v-model="kameraDialog" max-width="700px">
      <v-card>
        <v-card-title class="dialog-header">
          <v-icon left color="primary">mdi-camera</v-icon>
          Barkod Tara
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text>
          <video ref="video" width="100%" height="auto" autoplay></video>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="error" @click="(kameraDialog = false), stopCamera()">Kapat</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Snackbar -->
    <v-snackbar v-model="snackbar" color="error" timeout="3000">
      <span class="white--text">Ürün başarıyla silindi!</span>
      <v-btn color="pink" text @click="snackbar = false">Kapat</v-btn>
    </v-snackbar>
  </v-container>
</template>

<script>
import axios from "axios";
import ProductForm from "./ProductForm.vue";
import ProductList from "./ProductList.vue";

export default {
  components: { ProductForm, ProductList },
  data() {
    return {
      search: "",
      kameraDialog: false,
      urunler: [],
      duzenleDialog: false,
      yeniUrunDialog: false,
      deleteDialog: false,
      seciliUrun: {},
      duzenleFormValid: false,
      urunSilId: null,
      snackbar: false,
      videoStream: null,
      categories: [],
      materials: []
    };
  },
  mounted() {
    this.fetchProducts();
    this.fetchCategories();
    this.fetchMaterials();
  },
  methods: {
    async fetchProducts() {
      try {
        const res = await axios.get("http://localhost:5000/api/products");
        this.urunler = res.data; // direkt backend field'ları alıyoruz
      } catch (err) {
        console.error("Ürünler alınamadı:", err);
      }
    },
    async fetchCategories() {
      const res = await axios.get("http://localhost:5000/api/categories");
      this.categories = res.data;
    },
    async fetchMaterials() {
      const res = await axios.get("http://localhost:5000/api/materials");
      this.materials = res.data;
    },
    async urunKaydet(yeni) {
      try {
        const res = await axios.post("http://localhost:5000/api/products", yeni);
        this.urunler.push(res.data);
        this.yeniUrunDialog = false;
      } catch (err) {
        console.error("Ürün eklenemedi:", err.response?.data || err);
      }
    },
    urunSil(id) {
      this.urunSilId = id;
      this.deleteDialog = true;
    },
    async confirmDelete() {
      try {
        await axios.delete(`http://localhost:5000/api/products/${this.urunSilId}`);
        this.urunler = this.urunler.filter((u) => u._id !== this.urunSilId);
        this.deleteDialog = false;
        this.snackbar = true;
      } catch (err) {
        console.error("Silme hatası:", err);
      }
    },
    duzenlemeBaslat(urun) {
      this.seciliUrun = { ...urun }; // mapping yok → direkt backend alanları
      this.duzenleDialog = true;
    },
    async duzenlemeKaydet() {
      if (this.$refs.duzenleForm.validate()) {
        try {
          const updated = await axios.put(
              `http://localhost:5000/api/products/${this.seciliUrun._id}`,
              this.seciliUrun
          );

          const index = this.urunler.findIndex((u) => u._id === this.seciliUrun._id);
          if (index !== -1) {
            this.$set(this.urunler, index, updated.data);
          }
          this.duzenleDialog = false;
        } catch (err) {
          console.error("Güncelleme hatası:", err.response?.data || err);
        }
      }
    },
    startCamera() {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices
            .getUserMedia({ video: true })
            .then((stream) => {
              this.$refs.video.srcObject = stream;
              this.videoStream = stream;
            })
            .catch((error) => {
              console.error("Kamera hatası:", error);
            });
      } else {
        alert("Tarayıcınız kamera akışını desteklemiyor!");
      }
    },
    stopCamera() {
      if (this.videoStream) {
        let tracks = this.videoStream.getTracks();
        tracks.forEach((track) => track.stop());
      }
    }
  },
  watch: {
    kameraDialog(newValue) {
      if (newValue) {
        this.startCamera();
      } else {
        this.stopCamera();
      }
    }
  }
};
</script>

<style>
.rounded-input .v-input__control,
.rounded-input .v-field {
  border-radius: 9999px !important;
}
</style>
