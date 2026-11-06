<template>
  <div class="workspace-page">
    <header class="page-heading">
      <div>
        <div class="eyebrow">İŞLETME <span class="eyebrow-separator">/</span> MÜŞTERİLER</div>
        <h1>Müşteri yönetimi</h1>
        <p>Müşteri kayıtlarını, iletişim bilgilerini ve hesap türlerini tek yerden yönetin.</p>
      </div>
      <v-btn depressed class="primary-action" @click="openNew">
        <v-icon left small>mdi-account-plus-outline</v-icon> Yeni müşteri
      </v-btn>
    </header>

    <v-alert v-if="loadError" dense text type="error" class="mb-4">{{ loadError }}</v-alert>

    <v-row class="summary-row">
      <v-col cols="12" sm="4">
        <section class="summary-card">
          <div class="summary-icon blue"><v-icon>mdi-account-group-outline</v-icon></div>
          <div><span>Toplam müşteri</span><strong>{{ musteriler.length.toLocaleString('tr-TR') }}</strong></div>
        </section>
      </v-col>
      <v-col cols="12" sm="4">
        <section class="summary-card">
          <div class="summary-icon violet"><v-icon>mdi-account-outline</v-icon></div>
          <div><span>Bireysel</span><strong>{{ individualCount.toLocaleString('tr-TR') }}</strong></div>
        </section>
      </v-col>
      <v-col cols="12" sm="4">
        <section class="summary-card">
          <div class="summary-icon amber"><v-icon>mdi-domain</v-icon></div>
          <div><span>Kurumsal</span><strong>{{ corporateCount.toLocaleString('tr-TR') }}</strong></div>
        </section>
      </v-col>
    </v-row>

    <section class="content-panel">
      <div class="panel-toolbar">
        <div>
          <h2>Müşteri kayıtları</h2>
          <p>{{ filteredMusteriler.length }} kayıt listeleniyor</p>
        </div>
        <v-text-field
          v-model.trim="search"
          placeholder="Ad, telefon veya e-posta ara"
          prepend-inner-icon="mdi-magnify"
          outlined dense clearable hide-details
          class="table-search"
        />
      </div>

      <v-data-table
        :headers="headers"
        :items="filteredMusteriler"
        :loading="loading"
        :items-per-page="10"
        :footer-props="{ 'items-per-page-options': [10, 25, 50] }"
        class="business-table"
        no-data-text="Henüz müşteri kaydı bulunmuyor."
        no-results-text="Aramanızla eşleşen müşteri bulunamadı."
      >
        <template v-slot:item.name="{ item }">
          <button class="customer-name-cell" @click="selectMusteri(item)">
            <span class="customer-avatar">{{ initials(item.name) }}</span>
            <span><strong>{{ item.name || 'İsimsiz müşteri' }}</strong><small>{{ item.email || 'E-posta belirtilmemiş' }}</small></span>
          </button>
        </template>
        <template v-slot:item.phone="{ item }">
          <span class="muted-cell">{{ item.phone || '—' }}</span>
        </template>
        <template v-slot:item.customerType="{ item }">
          <span class="type-pill" :class="item.customerType === 'kurumsal' ? 'type-business' : 'type-person'">
            {{ item.customerType === 'kurumsal' ? 'Kurumsal' : 'Bireysel' }}
          </span>
        </template>
        <template v-slot:item.islemler="{ item }">
          <div class="row-actions">
            <v-tooltip top><template v-slot:activator="{ on, attrs }"><v-btn icon small v-bind="attrs" v-on="on" @click.stop="selectMusteri(item)"><v-icon small>mdi-eye-outline</v-icon></v-btn></template><span>Detay</span></v-tooltip>
            <v-tooltip top><template v-slot:activator="{ on, attrs }"><v-btn icon small v-bind="attrs" v-on="on" @click.stop="editMusteri(item)"><v-icon small>mdi-pencil-outline</v-icon></v-btn></template><span>Düzenle</span></v-tooltip>
            <v-tooltip top><template v-slot:activator="{ on, attrs }"><v-btn icon small v-bind="attrs" v-on="on" @click.stop="onDelete(item)"><v-icon small>mdi-archive-outline</v-icon></v-btn></template><span>Arşivle</span></v-tooltip>
          </div>
        </template>
        <template v-slot:loading><div class="table-state"><v-progress-circular indeterminate size="26" width="2" /> <span>Müşteriler yükleniyor…</span></div></template>
        <template v-slot:no-data><div class="table-state"><v-icon large>mdi-account-search-outline</v-icon><strong>Müşteri bulunamadı</strong><span>Yeni müşteri ekleyebilir veya arama kriterini değiştirebilirsiniz.</span></div></template>
      </v-data-table>
    </section>

    <v-dialog v-model="detailDialog" max-width="560">
      <v-card class="premium-dialog">
        <div class="dialog-heading"><div><span class="dialog-kicker">MÜŞTERİ KARTI</span><h2>{{ selectedMusteri && selectedMusteri.name }}</h2></div><v-btn icon @click="detailDialog = false"><v-icon>mdi-close</v-icon></v-btn></div>
        <v-card-text v-if="selectedMusteri" class="detail-grid">
          <div><span>Telefon</span><strong>{{ selectedMusteri.phone || '—' }}</strong></div>
          <div><span>E-posta</span><strong>{{ selectedMusteri.email || '—' }}</strong></div>
          <div><span>Müşteri türü</span><strong>{{ selectedMusteri.customerType === 'kurumsal' ? 'Kurumsal' : 'Bireysel' }}</strong></div>
          <div class="detail-wide"><span>Adres</span><strong>{{ selectedMusteri.address || 'Adres bilgisi girilmemiş' }}</strong></div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="dialog" max-width="560" persistent>
      <v-card class="premium-dialog">
        <div class="dialog-heading"><div><span class="dialog-kicker">MÜŞTERİ BİLGİLERİ</span><h2>{{ editMode ? 'Müşteriyi düzenle' : 'Yeni müşteri' }}</h2></div><v-btn icon @click="dialog = false"><v-icon>mdi-close</v-icon></v-btn></div>
        <v-card-text><CustomerForm ref="customerForm" :musteriProp="editTarget" @ekle="musteriKaydet" @close="dialog = false" /></v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="420">
      <v-card class="premium-dialog">
        <div class="dialog-heading"><div><span class="dialog-kicker">KAYIT YÖNETİMİ</span><h2>Müşteriyi arşivle?</h2></div></div>
        <v-card-text class="dialog-description">{{ deleteTarget && deleteTarget.name }} kaydı arşivlenecek. Bu işlem geri alınamayabilir.</v-card-text>
        <v-card-actions class="dialog-actions"><v-spacer/><v-btn text @click="deleteDialog = false">Vazgeç</v-btn><v-btn depressed color="error" :loading="deleting" @click="confirmDelete">Arşivle</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3000">{{ snackbar.text }}</v-snackbar>
  </div>
</template>

<script>
import apiService from "@/services/api";
import CustomerForm from "./CustomerForm.vue";

export default {
  name: "CustomerPage",
  components: { CustomerForm },
  data() {
    return {
      search: "",
      selectedMusteri: null,
      detailDialog: false,
      dialog: false,
      deleteDialog: false,
      deleteTarget: null,
      deleting: false,
      loading: false,
      loadError: "",
      snackbar: { show: false, text: "", color: "success" },
      editMode: false,
      editTarget: null,
      headers: [
        { text: "Müşteri", value: "name" },
        { text: "Telefon", value: "phone" },
        { text: "Müşteri türü", value: "customerType", width: 140 },
        { text: "İşlemler", value: "islemler", sortable: false, align: "end", width: 130 }
      ],
      musteriler: []
    };
  },
  computed: {
    filteredMusteriler() {
      const query = String(this.search || "").toLocaleLowerCase("tr-TR");
      if (!query) return this.musteriler;
      return this.musteriler.filter(m =>
        [m.name, m.phone, m.email, m.address].filter(Boolean)
          .join(" ").toLocaleLowerCase("tr-TR").includes(query)
      );
    },
    individualCount() { return this.musteriler.filter(m => m.customerType !== "kurumsal").length; },
    corporateCount() { return this.musteriler.filter(m => m.customerType === "kurumsal").length; }
  },
  mounted() { this.fetchMusteriler(); },
  methods: {
    async fetchMusteriler() {
      this.loading = true;
      this.loadError = "";
      try {
        const result = await apiService.get("/api/customers");
        this.musteriler = Array.isArray(result) ? result : [];
      } catch (err) {
        this.loadError = err.message || "Müşteri kayıtları yüklenemedi. Lütfen tekrar deneyin.";
      } finally {
        this.loading = false;
      }
    },
    initials(name) {
      return String(name || "?").trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0).toLocaleUpperCase("tr-TR")).join("");
    },
    selectMusteri(m) { this.selectedMusteri = m; this.detailDialog = true; },
    openNew() { this.editMode = false; this.editTarget = null; this.dialog = true; },
    editMusteri(m) { this.editMode = true; this.editTarget = { ...m }; this.dialog = true; },
    musteriKaydet(musteri) {
      if (this.editMode) {
        const index = this.musteriler.findIndex(m => m._id === musteri._id);
        if (index !== -1) this.$set(this.musteriler, index, musteri);
        this.showSnackbar("Müşteri bilgileri güncellendi.", "success");
      } else {
        this.musteriler.unshift(musteri);
        this.showSnackbar("Yeni müşteri kaydedildi.", "success");
      }
      this.dialog = false;
      this.editMode = false;
      this.editTarget = null;
    },
    onDelete(musteri) { this.deleteTarget = musteri; this.deleteDialog = true; },
    async confirmDelete() {
      if (!this.deleteTarget || this.deleting) return;
      this.deleting = true;
      try {
        await apiService.delete("/api/customers/" + this.deleteTarget._id);
        this.musteriler = this.musteriler.filter(m => m._id !== this.deleteTarget._id);
        this.showSnackbar("Müşteri kaydı arşivlendi.", "success");
        this.deleteDialog = false;
      } catch (err) {
        this.showSnackbar(err.message || "Müşteri arşivlenemedi.", "error");
      } finally {
        this.deleting = false;
      }
    },
    showSnackbar(text, color) { this.snackbar = { show: true, text, color }; }
  }
};
</script>

<style scoped>
.workspace-page { color:var(--jp-text,#e6edf7); }
.page-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin:4px 0 24px; }
.eyebrow,.dialog-kicker { color:#71839d; font-size:9px; font-weight:800; letter-spacing:1.45px; }
.eyebrow-separator { padding:0 6px; color:#3d83d9; }
.page-heading h1 { margin:9px 0 6px; color:#f2f6fc; font:800 clamp(23px,3vw,29px) 'Manrope',sans-serif; letter-spacing:-.7px; }
.page-heading p { margin:0; color:#8292a9; font-size:12px; }
.primary-action { height:40px !important; padding:0 16px !important; color:#fff !important; background:#216bd0 !important; border-radius:8px !important; text-transform:none !important; font-size:11px !important; font-weight:700 !important; }
.summary-row { margin:0 -7px 10px !important; }
.summary-row > .v-col { padding:7px !important; }
.summary-card { display:flex; align-items:center; gap:13px; min-height:82px; padding:15px 17px; border:1px solid rgba(148,163,184,.13); border-radius:11px; background:linear-gradient(145deg,#111d30,#0e1726); }
.summary-icon { display:grid; place-items:center; width:38px; height:38px; border-radius:10px; }
.summary-icon.blue { color:#69adff; background:rgba(46,130,239,.14); }
.summary-icon.violet { color:#b49aff; background:rgba(145,108,237,.14); }
.summary-icon.amber { color:#f2bd64; background:rgba(225,161,60,.13); }
.summary-card div:last-child { display:flex; flex-direction:column; gap:4px; }
.summary-card span { color:#8191a8; font-size:10px; }
.summary-card strong { color:#f0f5fc; font:800 20px 'Manrope',sans-serif; }
.content-panel { overflow:hidden; border:1px solid rgba(148,163,184,.14); border-radius:13px; background:#101a2a; }
.panel-toolbar { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:19px 20px 12px; }
.panel-toolbar h2 { margin:0; color:#eaf0f8; font:700 15px 'Manrope',sans-serif; }
.panel-toolbar p { margin:5px 0 0; color:#73849c; font-size:10px; }
.table-search { max-width:310px; }
.table-search >>> .v-input__slot { min-height:38px !important; background:rgba(255,255,255,.025) !important; }
.table-search >>> fieldset { border-color:rgba(148,163,184,.18) !important; }
.table-search >>> input { color:#e6edf7 !important; font-size:11px; }
.business-table { background:transparent !important; color:#dce5f1 !important; }
.business-table >>> table thead th { height:43px; color:#7f90a8 !important; background:rgba(255,255,255,.018); font-size:9px !important; font-weight:800 !important; letter-spacing:.7px; text-transform:uppercase; border-bottom:1px solid rgba(148,163,184,.13) !important; }
.business-table >>> table tbody td { height:58px; color:#aebbd0 !important; font-size:11px; border-bottom:1px solid rgba(148,163,184,.08) !important; }
.business-table >>> table tbody tr:hover { background:rgba(63,133,220,.055) !important; }
.customer-name-cell { display:flex; align-items:center; gap:10px; padding:4px 0; text-align:left; }
.customer-avatar { display:grid; place-items:center; width:32px; height:32px; flex-shrink:0; border-radius:9px; color:#91c4ff; background:rgba(47,126,221,.15); font-size:10px; font-weight:800; }
.customer-name-cell > span:last-child { display:flex; flex-direction:column; gap:3px; }
.customer-name-cell strong { color:#e6edf7; font-size:11px; font-weight:700; }
.customer-name-cell small { color:#73849c; font-size:9px; }
.muted-cell { color:#aab8cb; }
.type-pill { display:inline-flex; padding:4px 8px; border-radius:5px; font-size:9px; font-weight:700; }
.type-business { color:#c1a7ff; background:rgba(145,108,237,.13); }
.type-person { color:#82c3ff; background:rgba(46,130,239,.13); }
.row-actions { display:flex; justify-content:flex-end; gap:2px; }
.row-actions .v-btn { color:#8293aa !important; }
.row-actions .v-btn:hover { color:#75b6ff !important; }
.table-state { display:flex; flex-direction:column; align-items:center; gap:8px; padding:32px 12px; color:#7f90a8; font-size:10px; }
.table-state strong { color:#cbd6e5; font-size:12px; }
.premium-dialog { padding:7px; border:1px solid rgba(148,163,184,.16) !important; border-radius:13px !important; background:#111d30 !important; color:#e8eef8 !important; }
.dialog-heading { display:flex; align-items:center; justify-content:space-between; padding:17px 18px 11px; }
.dialog-heading h2 { margin:5px 0 0; color:#edf3fb; font:700 17px 'Manrope',sans-serif; }
.detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:17px; padding:12px 20px 22px !important; }
.detail-grid div { display:flex; flex-direction:column; gap:5px; }
.detail-grid span { color:#7f90a8; font-size:9px; }
.detail-grid strong { color:#dce5f1; font-size:11px; font-weight:600; overflow-wrap:anywhere; }
.detail-wide { grid-column:1/-1; }
.dialog-description { color:#aab8ca !important; font-size:12px; }
.dialog-actions { padding:8px 18px 17px; }
@media(max-width:600px) { .page-heading { align-items:flex-start; flex-direction:column; } .panel-toolbar { align-items:stretch; flex-direction:column; } .table-search { max-width:none; } .detail-grid { grid-template-columns:1fr; } .detail-wide { grid-column:auto; } }
</style>