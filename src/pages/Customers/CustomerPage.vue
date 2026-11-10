<template>
  <div class="jp-page-shell customers-page-shell">
    <!-- Header -->
    <div class="jp-page-header">
      <div class="page-heading-left">
        <div>
          <div class="jp-section-label">{{ $t('customers.musteriVeCariIliskileri') }}</div>
          <h1 class="page-title">
            <v-icon size="20" color="primary">mdi-account-group</v-icon>
            {{ $t('customers.musteriYonetimiCari') }}
          </h1>
        </div>
      </div>
      <div class="header-actions">
        <v-btn
          size="small"
          class="jp-secondary"
          :loading="loading"
          @click="fetchMusteriler"
        >
          <v-icon start size="14">mdi-refresh</v-icon>
          {{ $t('common.refresh') }}
        </v-btn>
        <v-btn
          size="small"
          class="jp-primary"
          @click="openNew"
        >
          <v-icon start size="14">mdi-account-plus</v-icon>
          {{ $t('customers.yeniMusteriEkle') }}
        </v-btn>
      </div>
    </div>

    <!-- Customer KPI Ribbon -->
    <div class="customer-kpi-row">
      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-info);">
          <v-icon size="18">mdi-account-multiple</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('customers.toplamKayit') }}</span>
          <div class="jp-stat-value tabular">{{ $t('customers.p0Musteri', { p0: musteriler.length }) }}</div>
        </div>
      </div>
      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-success);">
          <v-icon size="18">mdi-account-check</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('customers.bireysel') }}</span>
          <div class="jp-stat-value tabular">{{ $t('customers.p0Kisi', { p0: bireyselSayisi }) }}</div>
        </div>
      </div>
      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-primary);">
          <v-icon size="18">mdi-domain</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('customers.kurumsalToptan') }}</span>
          <div class="jp-stat-value tabular">{{ $t('customers.p0Sirket', { p0: kurumsalSayisi }) }}</div>
        </div>
      </div>
      <div class="jp-stat-card">
        <div class="jp-stat-icon-wrap" style="color: var(--jp-accent);">
          <v-icon size="18">mdi-shield-account-outline</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ $t('customers.dogrulanmisIletisim') }}</span>
          <div class="jp-stat-value tabular">{{ $t('customers.p0Numara', { p0: telefonluSayisi }) }}</div>
        </div>
      </div>
    </div>

    <!-- Split Cockpit Layout: Table (65%) + Dossier Card (35%) -->
    <div class="customers-split-grid">
      <!-- Left: Customers Table Card -->
      <div class="customer-table-card jp-card">
        <div class="table-toolbar">
          <div class="search-input-wrap">
            <v-icon size="16" class="search-icon">mdi-magnify</v-icon>
            <input
              v-model.trim="search"
              type="search"
              :placeholder="$t('customers.adTelefonVeyaEPosta')"
              class="customer-search-field"
            />
          </div>

          <div class="filter-controls">
            <select v-model="typeFilter" class="compact-select" :aria-label="$t('customers.musteriTuru')">
              <option value="">{{ $t('customers.tumTurler') }}</option>
              <option value="bireysel">{{ $t('customers.bireysel') }}</option>
              <option value="kurumsal">{{ $t('customers.kurumsal') }}</option>
            </select>
            <span class="record-counter tabular">{{ $t('customers.p0Kayit', { p0: filteredMusteriler.length }) }}</span>
          </div>
        </div>

        <div class="table-scroll-wrap">
          <table class="jp-enterprise-table">
            <thead>
              <tr>
                <th>{{ $t('customers.musteriAdiUnvan') }}</th>
                <th style="width: 130px;">{{ $t('customers.telefon') }}</th>
                <th>{{ $t('customers.ePosta') }}</th>
                <th style="width: 100px;">{{ $t('customers.tur') }}</th>
                <th class="text-center" style="width: 90px;">{{ $t('customers.islemler') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in filteredMusteriler"
                :key="item._id"
                :class="{ 'selected-row': selectedMusteri?._id === item._id }"
                @click="selectMusteri(item)"
              >
                <td class="font-weight-medium text-white">
                  <div class="customer-name-row">
                    <div class="customer-initials">{{ getInitials(item.name) }}</div>
                    <span>{{ item.name }}</span>
                  </div>
                </td>
                <td class="tabular text-disabled">{{ item.phone || '—' }}</td>
                <td class="text-disabled">{{ item.email || '—' }}</td>
                <td>
                  <span class="jp-badge" :class="item.customerType === 'kurumsal' ? 'jp-badge-gold' : 'jp-badge-info'">
                    {{ item.customerType === 'kurumsal' ? $t('customers.kurumsal') : $t('customers.bireysel') }}
                  </span>
                </td>
                <td class="text-center" @click.stop>
                  <div class="table-actions">
                    <v-btn
                      icon
                      size="x-small"
                      variant="text"
                      color="warning"
                      :title="$t('common.edit')"
                      @click="editMusteri(item)"
                    >
                      <v-icon size="15">mdi-pencil-outline</v-icon>
                    </v-btn>
                    <v-btn
                      v-if="$can('customers:delete')"
                      icon
                      size="x-small"
                      variant="text"
                      color="error"
                      :title="$t('common.delete')"
                      @click="onDelete(item)"
                    >
                      <v-icon size="15">mdi-delete-outline</v-icon>
                    </v-btn>
                  </div>
                </td>
              </tr>
              <tr v-if="!loading && !filteredMusteriler.length">
                <td colspan="5" class="empty-state-cell">
                  <v-icon size="32" class="mb-2 jp-empty-icon">mdi-account-search-outline</v-icon>
                  <div>{{ $t('customers.aradiginizKriterlereUygunMusteriKaydi') }}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Right: selected customer's dossier and account actions -->
      <CustomerDossier
        :customer="selectedMusteri"
        @voucher="openTahsilatDialog"
        @statement="openEkstreDialog"
        @edit="editMusteri"
        @sell="startSale"
      />
    </div>

    <!-- Müşteri Ekle / Düzenle Dialog -->
    <v-dialog v-model="dialogs.form" max-width="500px" persistent>
      <v-card class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" :color="editMode ? 'warning' : 'primary'" class="mr-2">
            {{ editMode ? 'mdi-account-edit' : 'mdi-account-plus' }}
          </v-icon>
          {{ editMode ? $t('customers.musteriBilgileriniDuzenle') : $t('customers.yeniMusteriKaydet') }}
        </v-card-title>
        <v-card-text>
          <CustomerForm
            :musteri-prop="editTarget"
            @ekle="musteriKaydet"
            @close="dialogs.form = false"
          />
        </v-card-text>
      </v-card>
    </v-dialog>

    <CustomerVoucherDialog v-model="dialogs.voucher" :customer="selectedMusteri" @saved="onVoucherSaved" />
    <CustomerStatementDialog v-model="dialogs.statement" :customer="selectedMusteri" />
  </div>
</template>

<script>
import { dateTime, normalizeSearch, t } from '@/i18n';
import apiService from '@/services/api';
import { confirmAction } from '@/services/confirm';
import { errorMessage } from '@/services/finance';
import CustomerForm from './CustomerForm.vue';
import CustomerDossier from '@/components/customers/CustomerDossier.vue';
import CustomerVoucherDialog from '@/components/customers/CustomerVoucherDialog.vue';
import CustomerStatementDialog from '@/components/customers/CustomerStatementDialog.vue';

/** Customers and their accounts: list, dossier, vouchers and statement (dialog components). */
export default {
  name: 'CustomerPage',
  components: { CustomerForm, CustomerDossier, CustomerVoucherDialog, CustomerStatementDialog },
  data() {
    return {
      search: '',
      typeFilter: '',
      selectedMusteri: null,
      loading: false,
      error: '',
      editMode: false,
      editTarget: null,
      musteriler: [],
      deleting: false,
      dialogs: { form: false, voucher: false, statement: false },
    };
  },
  computed: {
    filteredMusteriler() {
      const q = normalizeSearch(this.search).trim();
      return this.musteriler.filter((m) => {
        const matchesSearch = !q || [m.name, m.phone, m.email, m.address].some((v) => normalizeSearch(v).includes(q));
        const matchesType = !this.typeFilter || m.customerType === this.typeFilter;
        return matchesSearch && matchesType;
      });
    },
    bireyselSayisi() {
      return this.musteriler.filter((m) => m.customerType !== 'kurumsal').length;
    },
    kurumsalSayisi() {
      return this.musteriler.filter((m) => m.customerType === 'kurumsal').length;
    },
    telefonluSayisi() {
      return this.musteriler.filter((m) => Boolean(m.phone)).length;
    },
  },
  mounted() {
    this.fetchMusteriler();
  },
  methods: {
    async fetchMusteriler() {
      this.loading = true;
      this.error = '';
      try {
        const data = await apiService.get('/api/customers');
        this.musteriler = (Array.isArray(data) ? data : []).filter((c) => !c.isArchived);
        if (this.musteriler.length && !this.selectedMusteri) this.selectedMusteri = this.musteriler[0];
      } catch (err) {
        this.error = err.message || t('customers.loadFailed');
      } finally {
        this.loading = false;
      }
    },
    openNew() {
      this.editMode = false;
      this.editTarget = null;
      this.dialogs.form = true;
    },
    selectMusteri(item) {
      this.selectedMusteri = item;
    },
    editMusteri(item) {
      this.editMode = true;
      this.editTarget = { ...item };
      this.dialogs.form = true;
    },
    async onDelete(item) {
      // Guard against a double click firing two archive requests.
      if (this.deleting) return;
      const ok = await confirmAction({
        title: t('customers.musteriyiArsivleSil'),
        message: t('customers.isimliMusteriyiSistemdenKaldirmakIstedig', { name: item.name }),
        confirmLabel: t('customers.musteriyiKaldir'),
        tone: 'danger',
      });
      if (!ok) return;
      this.deleting = true;
      try {
        await apiService.delete(`/api/customers/${item._id}`);
        this.musteriler = this.musteriler.filter((m) => m._id !== item._id);
        if (this.selectedMusteri?._id === item._id) this.selectedMusteri = this.musteriler[0] || null;
        this.$store.dispatch('notifications/showSuccess', t('customers.musteriKaydiArsivlendi'));
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('customers.silmeHatasiP0', { p0: errorMessage(err) }));
      } finally {
        this.deleting = false;
      }
    },
    musteriKaydet(saved) {
      if (this.editMode) {
        const idx = this.musteriler.findIndex((m) => m._id === saved._id);
        if (idx !== -1) this.musteriler.splice(idx, 1, saved);
        if (this.selectedMusteri?._id === saved._id) this.selectedMusteri = saved;
        this.$store.dispatch('notifications/showSuccess', t('customers.musteriBilgileriGuncellendi'));
      } else {
        this.musteriler.unshift(saved);
        this.selectedMusteri = saved;
        this.$store.dispatch('notifications/showSuccess', t('customers.yeniMusteriBasariylaEklendi'));
      }
      this.dialogs.form = false;
    },
    async onVoucherSaved(customerId) {
      await this.fetchMusteriler();
      this.selectedMusteri = this.musteriler.find((m) => m._id === customerId) || this.selectedMusteri;
    },
    startSale(customer) {
      this.$router.push({ path: '/sales', query: { newSale: '1', customerId: customer._id } });
    },
    openTahsilatDialog() {
      if (this.selectedMusteri) this.dialogs.voucher = true;
    },
    openEkstreDialog() {
      if (this.selectedMusteri) this.dialogs.statement = true;
    },
    formatDate(dateVal) {
      return dateTime(dateVal);
    },
    getInitials(name) {
      if (!name) return 'M';
      return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
    },
  },
};
</script>

<style scoped>
.customers-page-shell {
  height: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  gap: 8px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* KPI Ribbon */
.customer-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  flex-shrink: 0;
}

/* Split Cockpit */
.customers-split-grid {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.customer-table-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 8px 12px;
}

.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--jp-border);
  flex-shrink: 0;
}

.search-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  width: 260px;
}

.search-icon {
  color: var(--jp-text-subtle);
}

.customer-search-field {
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--jp-text);
  font-size: 11px;
  width: 100%;
}
.customer-search-field::placeholder {
  color: var(--jp-text-subtle);
}

.filter-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.compact-select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
  color: var(--jp-text);
  font-size: 11px;
  outline: none;
}
.compact-select:focus {
  border-color: var(--jp-gold);
}

.record-counter {
  font-size: 11px;
  color: var(--jp-text-subtle);
}

/* Table Area */
.table-scroll-wrap {
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
  cursor: pointer;
}

.jp-enterprise-table tbody tr:hover {
  background: var(--jp-surface-card-hover);
}

.selected-row {
  background: var(--jp-gold-subtle) !important;
  border-left: 2px solid var(--jp-gold);
}

.customer-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.customer-initials {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--jp-surface-elevated);
  border: 1px solid var(--jp-border-light);
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  color: var(--jp-text-emphasis);
  flex-shrink: 0;
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

/* Dossier Card */
.dialog-header {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--jp-border);
}

@media (max-width: 950px) {
  .customers-split-grid {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .customer-kpi-row {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
