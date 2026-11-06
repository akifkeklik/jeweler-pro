<template>
  <div class="workspace-page">
    <header class="page-heading">
      <div><div class="eyebrow">İŞLETME <span>/</span> ENVANTER</div><h1>Ürün & stok yönetimi</h1><p>Ürün kataloğunu, gramaj ve fiyat bilgilerini, barkodları ve mevcut stoğu yönetin.</p></div>
      <div class="heading-actions"><v-btn outlined class="secondary-action" @click="kameraDialog = true"><v-icon left small>mdi-barcode-scan</v-icon> Barkod tara</v-btn><v-btn depressed class="primary-action" @click="yeniUrunDialog = true"><v-icon left small>mdi-plus</v-icon> Yeni ürün</v-btn></div>
    </header>

    <!-- Ana Kart -->
    <v-card class="inventory-panel pa-5">
      <!-- Arama Kutusu -->
      <v-text-field
          v-model="search"
          placeholder="Ürün Ara (Ad / ID / Barkod)"
          prepend-inner-icon="mdi-magnify"
          outlined
          dense
          hide-details
          clearable
          class="inventory-search mb-5"
      />

      <!-- Kamera ile Barkod Tara -->
      <v-btn color="primary" class="mb-5 d-none" @click="kameraDialog = true">
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
      <v-btn color="primary" class="mt-5 d-none" @click="yeniUrunDialog = true">
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
            <v-text-field v-model="seciliUrun.price" type="number" label="Satış Fiyatı (₺)" outlined dense class="rounded-input" />
            <v-text-field v-model="seciliUrun.costPrice" type="number" label="Birim Maliyet (₺)" outlined dense class="rounded-input" />
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
      <span class="white--text">Ürün arşivlendi.</span>
      <v-btn color="pink" text @click="snackbar = false">Kapat</v-btn>
    </v-snackbar>
  </div>
</template>

<script>
import apiService from "@/services/api";
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
        this.urunler = await apiService.get("/api/products");
      } catch (err) {
        console.error("Ürünler alınamadı:", err);
      }
    },
    async fetchCategories() {
      this.categories = await apiService.get("/api/categories");
    },
    async fetchMaterials() {
      this.materials = await apiService.get("/api/materials");
    },
    async urunKaydet(yeni) {
      try {
        const created = await apiService.post("/api/products", yeni);
        this.urunler.push(created);
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
        await apiService.delete("/api/products/" + this.urunSilId);
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
          const updated = await apiService.put("/api/products/" + this.seciliUrun._id, this.seciliUrun);

          const index = this.urunler.findIndex((u) => u._id === this.seciliUrun._id);
          if (index !== -1) {
            this.$set(this.urunler, index, updated);
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

<style scoped>
.workspace-page { color:#e6edf7; }
.page-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin:4px 0 24px; }
.eyebrow { color:#71839d; font-size:9px; font-weight:800; letter-spacing:1.45px; }
.eyebrow span { padding:0 6px; color:#3d83d9; }
.page-heading h1 { margin:9px 0 6px; color:#f2f6fc; font:800 clamp(23px,3vw,29px) 'Manrope',sans-serif; letter-spacing:-.7px; }
.page-heading p { margin:0; color:#8292a9; font-size:12px; }
.heading-actions { display:flex; gap:9px; }
.primary-action { height:40px !important; padding:0 16px !important; color:#fff !important; background:#216bd0 !important; border-radius:8px !important; text-transform:none !important; font-size:11px !important; font-weight:700 !important; }
.secondary-action { height:40px !important; color:#a9bad0 !important; border-color:rgba(148,163,184,.2) !important; border-radius:8px !important; text-transform:none !important; font-size:11px !important; }
.inventory-panel { border:1px solid rgba(148,163,184,.14) !important; border-radius:13px !important; background:#101a2a !important; box-shadow:none !important; }
.inventory-search { max-width:390px; }
.inventory-search >>> .v-input__slot { min-height:40px !important; background:rgba(255,255,255,.025) !important; }
.inventory-search >>> fieldset { border-color:rgba(148,163,184,.18) !important; }
.inventory-search >>> input { color:#e6edf7 !important; font-size:11px; }
.inventory-panel >>> .v-data-table { background:transparent !important; color:#dce5f1 !important; }
.inventory-panel >>> .v-data-table-header th { color:#8292a9 !important; background:rgba(255,255,255,.018); font-size:9px !important; text-transform:uppercase; letter-spacing:.6px; }
.inventory-panel >>> tbody td { color:#aebbd0 !important; border-bottom-color:rgba(148,163,184,.08) !important; }
.inventory-panel >>> tbody tr:hover { background:rgba(63,133,220,.055) !important; }
.inventory-panel >>> .v-btn { text-transform:none; }
@media(max-width:600px) { .page-heading { align-items:flex-start; flex-direction:column; } .heading-actions { width:100%; } .heading-actions .v-btn { flex:1; } }
</style>