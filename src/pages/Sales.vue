<template>
  <div class="workspace-page">
    <header class="page-heading">
      <div><div class="eyebrow">İŞLETME <span>/</span> SATIŞLAR</div><h1>Satış yönetimi</h1><p>Gerçekleşen satışları arayın, filtreleyin ve işlem kayıtlarını yönetin.</p></div>
      <v-btn outlined class="refresh-action" :loading="loading" @click="fetchSales"><v-icon left small>mdi-refresh</v-icon> Yenile</v-btn>
    </header>
    <div class="sales-overview"><div><span>Listelenen satış</span><strong>{{ filteredSales.length.toLocaleString('tr-TR') }}</strong></div><div><span>Toplam ciro</span><strong>{{ toplamCiro.toLocaleString('tr-TR',{style:'currency',currency:'TRY'}) }}</strong></div><div><span>Müşteri sayısı</span><strong>{{ musteriSayisi.toLocaleString('tr-TR') }}</strong></div></div>

    <!-- Filtreleme + Tablo Alanı -->
    <v-card class="sales-panel pa-5" elevation="0">
      <!-- Filtreleme Alanı -->
      <v-row class="mb-4">
        <v-col cols="12" md="4">
          <v-text-field
              v-model="search"
              label="Satış Ara"
              prepend-inner-icon="mdi-magnify"
              solo
              filled
              rounded
              dense
              hide-details
          />
        </v-col>
        <v-col cols="12" md="4">
          <v-menu
              ref="dateMenu"
              v-model="dateMenu"
              :close-on-content-click="false"
              transition="scale-transition"
              offset-y
              min-width="auto"
          >
            <template v-slot:activator="{ on, attrs }">
              <v-text-field
                  v-model="dateRangeText"
                  label="Tarih Aralığı"
                  prepend-inner-icon="mdi-calendar"
                  readonly
                  v-bind="attrs"
                  v-on="on"
                  solo
              filled
                  rounded
                  dense
              />
            </template>
            <v-date-picker
                v-model="dateRange"
                range
                scrollable
                @change="dateMenu = false"
            />
          </v-menu>
        </v-col>
        <v-col cols="12" md="4">
          <v-select
              v-model="selectedCustomer"
              :items="customers"
              item-text="name"
              item-value="name"
              label="Müşteri Seç"
              solo
              filled
              rounded
              dense
          />
        </v-col>
      </v-row>

      <!-- Tablo -->
      <v-data-table
          :headers="headers"
          :items="filteredSales"
          :items-per-page="5"
          class="rounded-xl"
          dense
          hover
      >
        <template v-slot:[`item.totalPrice`]="{ item }">
          <v-chip color="green lighten-4" text-color="green darken-3" class="font-weight-medium">
            <v-icon left small>mdi-currency-try</v-icon>{{ item.totalPrice }}
          </v-chip>
        </template>

        <template v-slot:[`item.islemler`]="{ item }">
          <!-- Görüntüle -->
          <v-btn icon color="teal" text @click="viewSale(item)">
            <v-icon>mdi-eye</v-icon>
          </v-btn>
          <!-- Düzenle -->
          <v-btn icon color="blue" text @click="openEditDialog(item)">
            <v-icon>mdi-pencil</v-icon>
          </v-btn>
          <!-- Sil -->
          <v-btn icon color="red" text @click="openDeleteDialog(item)">
            <v-icon>mdi-cancel</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Görüntüleme Dialog -->
    <v-dialog v-model="viewDialog" max-width="500px">
      <v-card class="rounded-xl pa-4">
        <v-card-title class="text-h6 font-weight-bold">
          <v-icon left color="teal">mdi-eye</v-icon> Satış Detayı
        </v-card-title>
        <v-card-text>
          <p><strong>Satış ID:</strong> {{ selectedSale?._id }}</p>
          <p><strong>Müşteri:</strong> {{ selectedSale?.customerName }}</p>
          <p><strong>Ürün:</strong> {{ selectedSale?.productName }}</p>
          <p><strong>Miktar:</strong> {{ selectedSale?.quantity }}</p>
          <p><strong>Tutar:</strong> {{ selectedSale?.totalPrice }} ₺</p>
          <p><strong>Ödeme:</strong> {{ selectedSale?.paymentMethod }}</p>
          <p><strong>Tarih:</strong> {{ selectedSale?.date }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="teal" depressed rounded @click="viewDialog = false">Kapat</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Düzenleme Dialog -->
    <v-dialog v-model="editDialog" max-width="600px">
      <v-card class="rounded-xl pa-4">
        <v-card-title class="text-h6 font-weight-bold">
          <v-icon left color="blue">mdi-pencil</v-icon> Satışı Düzenle
        </v-card-title>
        <v-card-text>
          <p class="mb-3">Ürün, miktar ve satış tutarı işlem kaydının bütünlüğü için değiştirilemez.</p>
          <v-select
              v-model="editForm.paymentMethod"
              :items="['nakit','kredi kartı','havale']"
              label="Ödeme Yöntemi"
          />
          <v-text-field v-model="editForm.date" label="Tarih" type="date" />
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="grey" outlined rounded @click="editDialog = false">İptal</v-btn>
          <v-btn color="blue" depressed rounded @click="saveEdit">Kaydet</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Silme Onayı -->
    <v-dialog v-model="deleteDialog" max-width="400px" transition="dialog-bottom-transition">
      <v-card class="rounded-xl">
        <v-card-title class="text-h6 font-weight-bold">
          <v-icon color="red" left>mdi-alert-circle</v-icon> Satışı İptal Et
        </v-card-title>
        <v-card-text>Bu satışı iptal etmek istiyor musunuz? Satış kaydı korunacak ve ürün stoğu geri eklenecek.</v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn rounded outlined color="grey" @click="deleteDialog = false">İptal</v-btn>
          <v-btn rounded depressed color="red" @click="confirmDelete">Satışı İptal Et</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { mapActions, mapState } from 'vuex';

export default {
  data() {
    return {
      search: "",
      dateMenu: false,
      dateRange: [],
      selectedCustomer: null,

      // dialogs
      viewDialog: false,
      editDialog: false,
      deleteDialog: false,

      // dialog data
      selectedSale: null,
      editForm: {},
      deleteTarget: null,

      headers: [
        { text: "Satış ID", value: "_id" },
        { text: "Müşteri", value: "customerName" },
        { text: "Ürün", value: "productName" },
        { text: "Miktar", value: "quantity" },
        { text: "Toplam Tutar", value: "totalPrice" },
        { text: "Ödeme", value: "paymentMethod" },
        { text: "Tarih", value: "date" },
        { text: "İşlemler", value: "islemler", sortable: false, align: "center" },
      ],
    };
  },
  computed: {
    ...mapState('sales', ['sales', 'loading', 'error']),
    ...mapState('customers', { customers: 'customers' }),
    salesData() {
      return this.sales
    },
    stats() {
      return [
        { title: "Toplam Satış", value: this.salesData.length, icon: "mdi-cash", color: "linear-gradient(135deg, #4facfe, #00f2fe)" },
        { title: "Toplam Ciro", value: this.toplamCiro + ' ₺', icon: "mdi-finance", color: "linear-gradient(135deg, #43e97b, #38f9d7)" },
        { title: "En Çok Satılan", value: this.enCokSatilan, icon: "mdi-star", color: "linear-gradient(135deg, #fa709a, #fee140)" },
        { title: "Müşteri Sayısı", value: this.musteriSayisi, icon: "mdi-account-group", color: "linear-gradient(135deg, #667eea, #764ba2)" },
      ];
    },
    filteredSales() {
      return this.salesData.filter((s) => {
        const matchesSearch =
            (s.customerName + " " + s.productName)
                .toLowerCase()
                .includes(this.search.toLowerCase());

        const matchesCustomer =
            !this.selectedCustomer ||
            (s.customerName &&
                s.customerName.toLowerCase().trim() === this.selectedCustomer.toLowerCase().trim());

        let matchesDate = true;
        if (this.dateRange.length === 2) {
          const start = new Date(this.dateRange[0]);
          const end = new Date(this.dateRange[1]);
          const saleDate = new Date(s.date);
          matchesDate = saleDate >= start && saleDate <= end;
        }

        return matchesSearch && matchesCustomer && matchesDate;
      });
    },
    toplamCiro() {
      return this.salesData.reduce((sum, s) => sum + (s.totalPrice || 0), 0);
    },
    musteriSayisi() {
      const ids = this.salesData.map((s) => s.customerName);
      return new Set(ids).size;
    },
    enCokSatilan() {
      const counts = {};
      this.salesData.forEach((s) => {
        if (s.productName) {
          counts[s.productName] = (counts[s.productName] || 0) + s.quantity;
        }
      });
      const max = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return max ? max[0] : "-";
    },
    dateRangeText() {
      return this.dateRange.length === 2
          ? `${this.dateRange[0]} - ${this.dateRange[1]}`
          : "";
    },
  },
  async mounted() {
    try {
      await this.fetchSales()
      await this.fetchCustomers()
    } catch (error) {
      this.$store.dispatch('notifications/showError', 'Veri yüklenirken hata oluştu: ' + error.message)
    }
  },
  methods: {
    ...mapActions('sales', ['fetchSales', 'updateSale', 'deleteSale']),
    ...mapActions('customers', { fetchCustomers: 'fetchCustomers' }),
    viewSale(item) {
      this.selectedSale = item;
      this.viewDialog = true;
    },
    openEditDialog(item) {
      this.editForm = { ...item };
      this.editDialog = true;
    },
    async saveEdit() {
      try {
        await this.updateSale(this.editForm)
        this.$store.dispatch('notifications/showSuccess', 'Satış başarıyla güncellendi')
        this.editDialog = false;
      } catch (error) {
        this.$store.dispatch('notifications/showError', 'Güncelleme hatası: ' + error.message)
      }
    },
    openDeleteDialog(item) {
      this.deleteDialog = true;
      this.deleteTarget = item;
    },
    async confirmDelete() {
      try {
        await this.deleteSale(this.deleteTarget._id)
        this.$store.dispatch('notifications/showSuccess', 'Satış başarıyla silindi')
      } catch (error) {
        this.$store.dispatch('notifications/showError', 'Silme hatası: ' + error.message)
      }
      this.deleteDialog = false;
    },
  },
};
</script>

<style scoped>
.workspace-page { color:#e6edf7; }
.page-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin:4px 0 18px; }
.eyebrow { color:#71839d; font-size:9px; font-weight:800; letter-spacing:1.45px; }
.eyebrow span { padding:0 6px; color:#3d83d9; }
.page-heading h1 { margin:9px 0 6px; color:#f2f6fc; font:800 clamp(23px,3vw,29px) 'Manrope',sans-serif; letter-spacing:-.7px; }
.page-heading p { margin:0; color:#8292a9; font-size:12px; }
.refresh-action { height:39px !important; color:#a9bad0 !important; border-color:rgba(148,163,184,.2) !important; border-radius:8px !important; text-transform:none !important; font-size:11px !important; }
.sales-overview { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-bottom:13px; }
.sales-overview > div { display:flex; flex-direction:column; gap:6px; padding:14px 17px; border:1px solid rgba(148,163,184,.13); border-radius:10px; background:linear-gradient(145deg,#111d30,#0e1726); }
.sales-overview span { color:#8191a8; font-size:10px; }
.sales-overview strong { color:#f0f5fc; font:800 19px 'Manrope',sans-serif; }
.sales-panel { border:1px solid rgba(148,163,184,.14) !important; border-radius:13px !important; background:#101a2a !important; }
.sales-panel >>> .v-input__slot { background:rgba(255,255,255,.025) !important; }
.sales-panel >>> fieldset { border-color:rgba(148,163,184,.18) !important; }
.sales-panel >>> input,.sales-panel >>> .v-select__selection { color:#dce5f1 !important; font-size:11px; }
.sales-panel >>> .v-data-table { background:transparent !important; color:#dce5f1 !important; }
.sales-panel >>> .v-data-table-header th { height:43px; color:#8292a9 !important; background:rgba(255,255,255,.018); font-size:9px !important; text-transform:uppercase; letter-spacing:.6px; }
.sales-panel >>> tbody td { color:#aebbd0 !important; border-bottom-color:rgba(148,163,184,.08) !important; font-size:11px; }
.sales-panel >>> tbody tr:hover { background:rgba(63,133,220,.055) !important; }
.sales-panel >>> .v-btn { text-transform:none; }
@media(max-width:650px) { .page-heading { align-items:flex-start; flex-direction:column; } .sales-overview { grid-template-columns:1fr; } }
</style>