<template>
  <v-container fluid>
    <h2 class="mb-4">Müşteriler</h2>

    <!-- Müşteri Listesi -->
    <v-row>
      <v-col cols="12">
        <v-card class="pa-3">
          <v-text-field
              v-model="search"
              placeholder="Müşteri Ara (Ad / Telefon / E-posta)"
              prepend-inner-icon="mdi-magnify"
              outlined
              dense
              hide-details
              clearable
              class="search-bar mb-5"
          ></v-text-field>

          <v-data-table
              :headers="headers"
              :items="filteredMusteriler"
              dense
              :items-per-page="5"
              class="data-table"
          >
            <template v-slot:[`item.islemler`]="{ item }">
              <div class="action-buttons">
                <v-btn icon small color="primary"
                       @click.stop="selectMusteri(item)">
                  <v-icon>mdi-eye</v-icon>
                </v-btn>
                <v-btn icon small color="blue"
                       @click.stop="editMusteri(item)">
                  <v-icon>mdi-pencil</v-icon>
                </v-btn>
                <v-btn icon small color="error"
                       @click.stop="onDelete(item)">
                  <v-icon>mdi-delete</v-icon>
                </v-btn>
              </div>
            </template>
          </v-data-table>

          <!-- Yeni Müşteri Butonu -->
          <v-btn color="primary" block class="mt-4" @click="openNew">
            <v-icon left>mdi-account-plus</v-icon> Yeni Müşteri
          </v-btn>
        </v-card>
      </v-col>
    </v-row>

    <!-- Detay Dialog -->
    <v-dialog v-model="detailDialog" max-width="700px">
      <v-card>
        <v-card-title>
          {{ selectedMusteri?.name }}
          <v-spacer></v-spacer>
          <v-btn icon @click="detailDialog=false"><v-icon>mdi-close</v-icon></v-btn>
        </v-card-title>

        <v-card-text v-if="selectedMusteri">
          <p><v-icon small>mdi-phone</v-icon> {{ selectedMusteri.phone }}</p>
          <p><v-icon small>mdi-email</v-icon> {{ selectedMusteri.email }}</p>
          <p><v-icon small>mdi-home</v-icon> {{ selectedMusteri.address }}</p>
          <p><v-icon small>mdi-account</v-icon> {{ selectedMusteri.customerType }}</p>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Yeni / Düzenleme Müşteri Dialog -->
    <v-dialog v-model="dialog" max-width="500px">
      <v-card>
        <v-card-title>{{ editMode ? 'Müşteri Düzenle' : 'Müşteri Ekle' }}</v-card-title>
        <v-card-text>
          <CustomerForm
              ref="customerForm"
              :musteriProp="editTarget"
              @ekle="musteriKaydet"
              @close="dialog=false"
          />
        </v-card-text>
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
          <v-btn color="warning" text @click="deleteDialog=false">İptal</v-btn>
          <v-btn color="red" text @click="confirmDelete">Sil</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Bildirim -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3000">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>

<script>
import axios from "axios";
import CustomerForm from "./CustomerForm.vue";

export default {
  components: { CustomerForm },
  data() {
    return {
      search: "",
      selectedMusteri: null,
      detailDialog: false,
      dialog: false,
      deleteDialog: false,
      deleteTarget: null,
      snackbar: { show: false, text: "", color: "success" },
      editMode: false,
      editTarget: null,
      headers: [
        { text: "Ad", value: "name" },
        { text: "Telefon", value: "phone" },
        { text: "E-posta", value: "email" },
        { text: "Tür", value: "customerType" },
        { text: "İşlemler", value: "islemler", sortable: false, align: "center" },
      ],
      musteriler: []
    };
  },
  computed: {
    filteredMusteriler() {
      return this.musteriler.filter(m =>
          (m.name + " " + m.phone + " " + m.email)
              .toLowerCase()
              .includes(this.search.toLowerCase())
      );
    }
  },
  mounted() {
    this.fetchMusteriler();
  },
  methods: {
    async fetchMusteriler() {
      try {
        const res = await axios.get("http://localhost:5000/api/customers");
        this.musteriler = res.data;
      } catch (err) {
        console.error("Müşteriler alınamadı:", err);
      }
    },
    selectMusteri(m) {
      this.selectedMusteri = m;
      this.detailDialog = true;
    },
    openNew() {
      this.editMode = false;
      this.editTarget = null;
      this.dialog = true;
    },
    editMusteri(m) {
      this.editMode = true;
      this.editTarget = { ...m };
      this.dialog = true;
    },
    musteriKaydet(musteri) {
      if (this.editMode) {
        const index = this.musteriler.findIndex(m => m._id === musteri._id);
        if (index !== -1) {
          this.$set(this.musteriler, index, musteri);
        }
        this.showSnackbar("Müşteri başarıyla güncellendi", "info");
      } else {
        this.musteriler.push(musteri);
        this.showSnackbar("Müşteri başarıyla eklendi", "success");
      }
      this.dialog = false;
      this.editMode = false;
      this.editTarget = null;
    },
    onDelete(musteri) {
      this.deleteDialog = true;
      this.deleteTarget = musteri;
    },
    async confirmDelete() {
      try {
        await axios.delete(`http://localhost:5000/api/customers/${this.deleteTarget._id}`);
        this.musteriler = this.musteriler.filter(m => m._id !== this.deleteTarget._id);
        this.showSnackbar("Müşteri silindi", "error");
      } catch (err) {
        console.error("Silme hatası:", err);
      }
      this.deleteDialog = false;
      this.detailDialog = false;
    },
    showSnackbar(text, color) {
      this.snackbar = { show: true, text, color };
    }
  }
};
</script>

<style scoped>
.search-bar {
  background-color: #f1f3f4 !important;
  border-radius: 12px !important;
}
.action-buttons {
  display: flex;
  gap: 8px;
  justify-content: center;
}
</style>
