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

      <!-- Right: Selected Customer Cari Dossier -->
      <div class="customer-dossier-card jp-card">
        <div v-if="selectedMusteri" class="dossier-content">
          <div class="dossier-header">
            <div class="dossier-avatar-large">{{ getInitials(selectedMusteri.name) }}</div>
            <div class="dossier-name-block">
              <h3 class="dossier-title">{{ selectedMusteri.name }}</h3>
              <span class="jp-badge mt-1" :class="selectedMusteri.customerType === 'kurumsal' ? 'jp-badge-gold' : 'jp-badge-info'">
                {{ selectedMusteri.customerType === 'kurumsal' ? $t('customers.kurumsalCari') : $t('customers.bireyselCari') }}
              </span>
            </div>
          </div>

          <div class="dossier-body">
            <div class="dossier-info-row">
              <v-icon size="14" color="var(--jp-gold)">mdi-phone-outline</v-icon>
              <div>
                <small>{{ $t('customers.telefon2') }}</small>
                <strong>{{ selectedMusteri.phone || $t('customers.kayitliTelefonYok') }}</strong>
              </div>
            </div>
            <div class="dossier-info-row">
              <v-icon size="14" color="var(--jp-gold)">mdi-email-outline</v-icon>
              <div>
                <small>{{ $t('customers.ePosta2') }}</small>
                <strong>{{ selectedMusteri.email || $t('customers.kayitliEPostaYok') }}</strong>
              </div>
            </div>
            <div class="dossier-info-row">
              <v-icon size="14" color="var(--jp-gold)">mdi-map-marker-outline</v-icon>
              <div>
                <small>{{ $t('customers.adres') }}</small>
                <strong>{{ selectedMusteri.address || $t('customers.kayitliAdresBilgisiYok') }}</strong>
              </div>
            </div>
            <!-- Cari Bakiye Şeridi -->
            <div class="dossier-balance-card mt-3 pa-3 rounded" style="background: var(--jp-surface-muted); border: 1px solid var(--jp-border);">
              <div class="d-flex justify-space-between align-center">
                <span class="text-caption text-disabled">{{ $t('customers.cariTlBakiyesi') }}</span>
                <strong
                  class="tabular font-weight-bold"
                  :style="{ color: (selectedMusteri.balanceTry || 0) >= 0 ? 'var(--jp-success)' : 'var(--jp-danger)' }"
                >
                  {{ (selectedMusteri.balanceTry || 0) >= 0 ? '+' : '' }}{{ formatMoney(selectedMusteri.balanceTry || 0) }}
                </strong>
              </div>
              <div class="d-flex justify-space-between align-center mt-2">
                <span class="text-caption text-disabled">{{ $t('customers.hasAltinBakiyesi') }}</span>
                <strong
                  class="tabular font-weight-bold"
                  :style="{ color: (selectedMusteri.balanceGold || 0) >= 0 ? 'var(--jp-primary)' : 'var(--jp-danger)' }"
                >
                  {{ $t('customers.p0P1GrHas', { p0: (selectedMusteri.balanceGold || 0) >= 0 ? '+' : '', p1: $weight(selectedMusteri.balanceGold || 0, 3) }) }}
                </strong>
              </div>
            </div>
          </div>

          <div class="dossier-footer">
            <v-btn
              block
              size="small"
              class="jp-primary mb-2"
              @click="$router.push({ path: '/sales', query: { newSale: '1', customerId: selectedMusteri._id } })"
            >
              <v-icon start size="14">mdi-lightning-bolt</v-icon>
              {{ $t('customers.buMusteriyeSatisBaslat') }}
            </v-btn>
            <v-btn
              block
              size="small"
              class="jp-secondary mb-2"
              @click="openTahsilatDialog"
            >
              <v-icon start size="14">mdi-cash-plus</v-icon>
              {{ $t('customers.cariTahsilatOdemeYap') }}
            </v-btn>
            <v-btn
              block
              size="small"
              class="jp-secondary mb-2"
              @click="openEkstreDialog"
            >
              <v-icon start size="14">mdi-file-document-outline</v-icon>
              {{ $t('customers.cariHesapEkstresi') }}
            </v-btn>
            <v-btn
              block
              size="small"
              class="jp-secondary"
              @click="editMusteri(selectedMusteri)"
            >
              <v-icon start size="14">mdi-pencil</v-icon>
              {{ $t('customers.bilgileriGuncelle') }}
            </v-btn>
          </div>
        </div>

        <div v-else class="empty-dossier">
          <v-icon size="40" class="mb-2 jp-empty-icon">mdi-account-card-details-outline</v-icon>
          <div class="text-caption text-disabled text-center">
            {{ $t('customers.detaylariniVeIslemKartiniGoruntulemek') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Müşteri Ekle / Düzenle Dialog -->
    <v-dialog v-model="dialog" max-width="500px" persistent>
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
            @close="dialog = false"
          />
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Silme Onayı -->
    <v-dialog v-model="deleteDialog" max-width="420px">
      <v-card class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="error" class="mr-2">mdi-alert-circle</v-icon>
          {{ $t('customers.musteriyiArsivleSil') }}
        </v-card-title>
        <v-card-text class="text-caption">
          {{ $t('customers.isimliMusteriyiSistemdenKaldirmakIstedig', { name: deleteTarget?.name }) }}
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" @click="deleteDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn size="small" class="jp-btn-danger" :loading="deleting" :disabled="deleting" @click="confirmDelete">{{ $t('customers.musteriyiKaldir') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- CARİ TAHSİLAT / ÖDEME MODAL -->
    <v-dialog v-model="tahsilatDialog" max-width="520px">
      <v-card class="pa-3">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="primary" class="mr-2">mdi-cash-register</v-icon>
          {{ $t('customers.cariTahsilatOdemeGirisi') }}
        </v-card-title>
        <v-card-text>
          <div class="text-caption text-disabled mb-3">
            {{ $t('common.customer') }} <strong>{{ selectedMusteri?.name }}</strong>
          </div>

          <div class="form-group mb-3">
            <label class="form-label" for="customerpage-f1">{{ $t('customers.islemTuru') }}</label>
            <select id="customerpage-f1" v-model="tahsilatForm.type" class="settings-select-full">
              <option value="tahsilat">{{ $t('customers.musteridenTahsilatBorcDuser') }}</option>
              <option value="tediye">{{ $t('customers.musteriyeOdemeBorcArtarAlacak') }}</option>
              <!-- Opening balances move equity: backend requires accounts:manage. -->
              <option v-if="$can('accounts:manage')" value="devir">{{ $t('customers.devirAcilisBakiyesi') }}</option>
              <option value="hurda_alimi">{{ $t('customers.hurdaEskiAltinAlimi') }}</option>
            </select>
          </div>

          <div v-if="tahsilatForm.type === 'devir'" class="form-group mb-3">
            <label class="form-label" for="customerpage-f2">{{ $t('customers.devirYonu') }}</label>
            <select id="customerpage-f2" v-model="tahsilatForm.direction" class="settings-select-full">
              <option value="borc">{{ $t('customers.musteriBizeBorclu') }}</option>
              <option value="alacak">{{ $t('customers.bizMusteriyeBorcluyuz') }}</option>
            </select>
          </div>

          <div v-if="tahsilatForm.type !== 'devir'" class="form-group mb-3">
            <label class="form-label" for="customerpage-f3">{{ $t('customers.odemeAraci') }}</label>
            <select id="customerpage-f3" v-model="tahsilatForm.paymentMethod" class="settings-select-full">
              <option value="nakit">{{ $t('customers.nakitTl') }}</option>
              <option value="kredi kartı">{{ $t('customers.krediKartiPos') }}</option>
              <option value="havale">{{ $t('customers.bankaHavalesiEft') }}</option>
              <option v-if="tahsilatForm.type === 'hurda_alimi'" value="cari">{{ $t('customers.musteriCarisineAlacakYaz') }}</option>
            </select>
          </div>

          <template v-if="tahsilatForm.type === 'hurda_alimi'">
            <div class="d-flex gap-2 mb-3">
              <div class="form-group flex-1">
                <label class="form-label" for="customerpage-f4">{{ $t('customers.brutGramaj') }}</label>
                <input id="customerpage-f4" v-model.trim="tahsilatForm.weightGrams" type="text" inputmode="decimal" placeholder="0.000" class="settings-input-full tabular" />
              </div>
              <div class="form-group flex-1">
                <label class="form-label" for="customerpage-f5">{{ $t('customers.ayar') }}</label>
                <select id="customerpage-f5" v-model.number="tahsilatForm.karat" class="settings-select-full">
                  <option v-for="o in purityOptions" :key="o.karat" :value="o.karat">{{ o.label }}</option>
                </select>
              </div>
              <div class="form-group flex-1">
                <label class="form-label" for="customerpage-f6">{{ $t('customers.fire') }}</label>
                <input id="customerpage-f6" v-model.trim="tahsilatForm.deductionMilyem" type="text" inputmode="decimal" placeholder="0" class="settings-input-full tabular" />
              </div>
            </div>
            <div class="d-flex gap-2 mb-3">
              <div class="form-group flex-1">
                <label class="form-label" for="customerpage-f7">{{ $t('customers.anlasilanTutarBossaFiyattanHesaplanir') }}</label>
                <input id="customerpage-f7" v-model.trim="tahsilatForm.amountTry" type="text" inputmode="decimal" placeholder="0.00" class="settings-input-full tabular" />
              </div>
              <div class="form-group flex-1">
                <label class="form-label" for="customerpage-f8">{{ $t('customers.hasAlisGramFiyatiBossa') }}</label>
                <input id="customerpage-f8" v-model.trim="tahsilatForm.manualPricePerGram" type="text" inputmode="decimal" :placeholder="$t('customers.canliAlisFiyati')" class="settings-input-full tabular" />
              </div>
            </div>
          </template>

          <div v-else class="d-flex gap-2 mb-3">
            <div class="form-group flex-1">
              <label class="form-label" for="customerpage-f9">{{ $t('customers.tutar') }}</label>
              <input id="customerpage-f9" v-model.trim="tahsilatForm.amountTry" type="text" inputmode="decimal" placeholder="0.00" class="settings-input-full tabular" />
            </div>
            <div class="form-group flex-1">
              <label class="form-label" for="customerpage-f10">{{ $t('customers.hasAltinGram') }}</label>
              <input id="customerpage-f10" v-model.trim="tahsilatForm.amountGoldGrams" type="text" inputmode="decimal" placeholder="0.000" class="settings-input-full tabular" />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="customerpage-f11">{{ $t('customers.aciklamaMakbuzNotu') }}</label>
            <input id="customerpage-f11"
              v-model.trim="tahsilatForm.description"
              type="text"
              :placeholder="$t('customers.orn22AyarBilezikBozdurma')"
              class="settings-input-full"
            />
          </div>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" @click="tahsilatDialog = false">{{ $t('customers.iptal') }}</v-btn>
          <v-btn
            size="small"
            class="jp-primary"
            :loading="tahsilatSaving"
            @click="submitTahsilat"
          >
            {{ $t('customers.islemiKaydet') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- CARİ EKSTRE (LEDGER) MODAL -->
    <v-dialog v-model="ekstreDialog" max-width="720px">
      <v-card class="pa-3">
        <v-card-title class="dialog-header d-flex justify-space-between align-center">
          <div class="d-flex align-center">
            <v-icon size="18" color="info" class="mr-2">mdi-file-document-outline</v-icon>
            <span>{{ $t('customers.cariHesapEkstresiP0', { p0: selectedMusteri?.name }) }}</span>
          </div>
          <v-btn icon size="x-small" variant="text" @click="ekstreDialog = false">
            <v-icon size="18">mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-card-text>
          <div v-if="loadingEkstre" class="text-center py-6">
            <v-progress-circular indeterminate size="24" color="primary"></v-progress-circular>
            <div class="text-caption text-disabled mt-2">{{ $t('customers.cariKayitlarGetiriliyor') }}</div>
          </div>
          <div v-else>
            <!-- Ekstre Bakiye Özeti -->
            <div class="d-flex gap-3 mb-3 pa-2 rounded" style="background: var(--jp-surface-muted);">
              <div>
                <small class="text-disabled">{{ $t('customers.netTlBakiyesi') }}</small>
                <div class="tabular font-weight-bold" :style="{ color: ekstreData.balanceTry >= 0 ? 'var(--jp-success)' : 'var(--jp-danger)' }">
                  {{ ekstreData.balanceTry >= 0 ? '+' : '' }}{{ formatMoney(ekstreData.balanceTry || 0) }}
                </div>
              </div>
              <div class="ml-4">
                <small class="text-disabled">{{ $t('customers.netHasAltinBakiyesi') }}</small>
                <div class="tabular font-weight-bold" :style="{ color: ekstreData.balanceGold >= 0 ? 'var(--jp-primary)' : 'var(--jp-danger)' }">
                  {{ $t('customers.p0P1GrHas', { p0: ekstreData.balanceGold >= 0 ? '+' : '', p1: $weight(ekstreData.balanceGold || 0, 3) }) }}
                </div>
              </div>
            </div>

            <p v-if="ekstreData.legacyHistory" class="text-caption text-disabled mb-2">
              {{ $t('customers.buMusterininYeniMuhasebeDefterinden') }}
            </p>
            <div class="table-scroll-wrap" style="max-height: 340px;">
              <table class="jp-enterprise-table">
                <thead>
                  <tr>
                    <th>{{ $t('customers.tarih') }}</th>
                    <th>{{ $t('customers.islemAciklama') }}</th>
                    <th class="text-right">{{ $t('customers.tutarTl') }}</th>
                    <th class="text-right">{{ $t('customers.hasGr') }}</th>
                    <th class="text-right">{{ $t('customers.bakiyeTl') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="entry in ekstreData.entries" :key="entry.id">
                    <td class="tabular text-caption text-disabled">{{ formatDate(entry.date) }}</td>
                    <td>
                      <span class="font-weight-medium" :title="entry.title">{{ $ledger(entry) }}</span>
                    </td>
                    <td class="text-right tabular font-weight-bold" :class="entry.direction === 'alacak' ? 'text-success' : 'text-danger'">
                      <template v-if="entry.amountTry">{{ entry.direction === 'alacak' ? '+' : '-' }}{{ formatMoney(entry.amountTry) }}</template>
                    </td>
                    <td class="text-right tabular" :class="entry.direction === 'alacak' ? 'text-success' : 'text-danger'">
                      <template v-if="entry.amountGold">{{ entry.direction === 'alacak' ? '+' : '-' }}{{ $weight(entry.amountGold, 3) }}</template>
                    </td>
                    <td class="text-right tabular" :style="{ color: (entry.balanceAfterTry || 0) >= 0 ? 'var(--jp-success)' : 'var(--jp-danger)' }">
                      {{ formatMoney(entry.balanceAfterTry || 0) }}
                    </td>
                  </tr>
                  <tr v-if="!ekstreData.entries?.length">
                    <td colspan="5" class="empty-state-cell">{{ $t('customers.henuzBuCariyeAitHareket') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { dateTime, money, normalizeSearch, t } from '@/i18n';
import apiService from "@/services/api";
import CustomerForm from "./CustomerForm.vue";
import { normalizeDecimalInput, newIdempotencyKey, errorMessage, PURITY_OPTIONS } from "@/services/finance";

function emptyVoucher() {
  return {
    type: 'tahsilat',
    paymentMethod: 'nakit',
    direction: 'borc',
    amountTry: '',
    amountGoldGrams: '',
    weightGrams: '',
    karat: 22,
    deductionMilyem: '',
    manualPricePerGram: '',
    description: '',
  };
}

export default {
  name: "CustomerPage",
  components: { CustomerForm },
  data() {
    return {
      search: "",
      typeFilter: "",
      selectedMusteri: null,
      dialog: false,
      deleteDialog: false,
      deleteTarget: null,
      deleting: false,
      loading: false,
      error: "",
      editMode: false,
      editTarget: null,
      musteriler: [],
      tahsilatDialog: false,
      tahsilatSaving: false,
      tahsilatForm: emptyVoucher(),
      tahsilatKey: '',
      purityOptions: PURITY_OPTIONS,
      ekstreDialog: false,
      loadingEkstre: false,
      ekstreData: {
        balanceTry: 0,
        balanceGold: 0,
        entries: [],
      },
    };
  },
  computed: {
    filteredMusteriler() {
      const q = normalizeSearch(this.search).trim();
      return this.musteriler.filter((m) => {
        const nameMatch = normalizeSearch(m.name).includes(q);
        const phoneMatch = normalizeSearch(m.phone).includes(q);
        const emailMatch = normalizeSearch(m.email).includes(q);
        const addressMatch = normalizeSearch(m.address).includes(q);
        const matchesSearch = !q || nameMatch || phoneMatch || emailMatch || addressMatch;

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
    }
  },
  mounted() {
    this.fetchMusteriler();
  },
  methods: {
    async fetchMusteriler() {
      this.loading = true;
      this.error = "";
      try {
        const data = await apiService.get("/api/customers");
        this.musteriler = (Array.isArray(data) ? data : []).filter((c) => !c.isArchived);
        if (this.musteriler.length && !this.selectedMusteri) {
          this.selectedMusteri = this.musteriler[0];
        }
      } catch (err) {
        this.error = err.message || t('customers.loadFailed');
      } finally {
        this.loading = false;
      }
    },
    openNew() {
      this.editMode = false;
      this.editTarget = null;
      this.dialog = true;
    },
    selectMusteri(item) {
      this.selectedMusteri = item;
    },
    editMusteri(item) {
      this.editMode = true;
      this.editTarget = { ...item };
      this.dialog = true;
    },
    onDelete(item) {
      this.deleteTarget = item;
      this.deleteDialog = true;
    },
    async confirmDelete() {
      // Guard against a double click firing two archive requests.
      if (!this.deleteTarget || this.deleting) return;
      this.deleting = true;
      try {
        await apiService.delete("/api/customers/" + this.deleteTarget._id);
        this.musteriler = this.musteriler.filter((m) => m._id !== this.deleteTarget._id);
        if (this.selectedMusteri?._id === this.deleteTarget._id) {
          this.selectedMusteri = this.musteriler[0] || null;
        }
        this.deleteDialog = false;
        this.$store.dispatch('notifications/showSuccess', t('customers.musteriKaydiArsivlendi'));
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('customers.silmeHatasiP0', { p0: err.message }));
      } finally {
        this.deleting = false;
      }
    },
    musteriKaydet(saved) {
      if (this.editMode) {
        const idx = this.musteriler.findIndex((m) => m._id === saved._id);
        if (idx !== -1) {
          this.musteriler.splice(idx, 1, saved);
        }
        if (this.selectedMusteri?._id === saved._id) {
          this.selectedMusteri = saved;
        }
        this.$store.dispatch('notifications/showSuccess', t('customers.musteriBilgileriGuncellendi'));
      } else {
        this.musteriler.unshift(saved);
        this.selectedMusteri = saved;
        this.$store.dispatch('notifications/showSuccess', t('customers.yeniMusteriBasariylaEklendi'));
      }
      this.dialog = false;
    },
    formatMoney(val) {
      return money(Number(val) || 0);
    },
    formatDate(dateVal) {
      return dateTime(dateVal);
    },
    openTahsilatDialog() {
      if (!this.selectedMusteri) return;
      this.tahsilatForm = emptyVoucher();
      // One key per voucher: a double click or retried request is applied once.
      this.tahsilatKey = newIdempotencyKey('voucher');
      this.tahsilatDialog = true;
    },
    async submitTahsilat() {
      if (!this.selectedMusteri) return;
      const f = this.tahsilatForm;
      const isScrap = f.type === 'hurda_alimi';
      const missing = isScrap
        ? !normalizeDecimalInput(f.weightGrams)
        : (!normalizeDecimalInput(f.amountTry) && !normalizeDecimalInput(f.amountGoldGrams));
      if (missing) {
        this.$store.dispatch('notifications/showError', isScrap ? t('customers.lutfenHurdaGramajiniGiriniz') : t('customers.lutfenGecerliBirTutarVeya'));
        return;
      }
      const payload = {
        customerId: this.selectedMusteri._id,
        type: f.type,
        description: f.description,
      };
      if (f.type === 'devir') payload.direction = f.direction;
      else payload.paymentMethod = f.paymentMethod;
      if (normalizeDecimalInput(f.amountTry)) payload.amountTry = normalizeDecimalInput(f.amountTry);
      if (!isScrap && normalizeDecimalInput(f.amountGoldGrams)) payload.amountGoldGrams = normalizeDecimalInput(f.amountGoldGrams);
      if (isScrap) {
        payload.weightGrams = normalizeDecimalInput(f.weightGrams);
        payload.karat = f.karat;
        if (normalizeDecimalInput(f.deductionMilyem)) payload.deductionMilyem = normalizeDecimalInput(f.deductionMilyem);
        if (normalizeDecimalInput(f.manualPricePerGram)) payload.manualPricePerGram = normalizeDecimalInput(f.manualPricePerGram);
      }

      this.tahsilatSaving = true;
      try {
        await apiService.post('/api/cash/transactions', payload, { headers: { 'Idempotency-Key': this.tahsilatKey } });
        this.$store.dispatch('notifications/showSuccess', t('customers.cariIslemKaydedildiKasaVe'));
        this.tahsilatDialog = false;
        await this.fetchMusteriler();
        this.selectedMusteri = this.musteriler.find((m) => m._id === payload.customerId) || this.selectedMusteri;
      } catch (err) {
        const message = err.code === 'MARKET_PRICE_UNAVAILABLE'
          ? t('customers.canliHasAlisFiyatiAlinamadi')
          : errorMessage(err);
        this.$store.dispatch('notifications/showError', t('customers.islemHatasiP0', { p0: message }));
      } finally {
        this.tahsilatSaving = false;
      }
    },
    async openEkstreDialog() {
      if (!this.selectedMusteri) return;
      this.ekstreDialog = true;
      this.loadingEkstre = true;
      try {
        const data = await apiService.get(`/api/cash/customer/${this.selectedMusteri._id}/ledger`);
        this.ekstreData = data || { balanceTry: 0, balanceGold: 0, entries: [] };
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('customers.ekstreAlinamadiP0', { p0: err.message }));
        this.ekstreData = { balanceTry: 0, balanceGold: 0, entries: [] };
      } finally {
        this.loadingEkstre = false;
      }
    },
    getInitials(name) {
      if (!name) return "M";
      return name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p.charAt(0).toUpperCase())
        .join("");
    }
  }
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
.customer-dossier-card {
  padding: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dossier-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.dossier-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--jp-border);
  flex-shrink: 0;
}

.dossier-avatar-large {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: var(--jp-gold-gradient);
  display: grid;
  place-items: center;
  font-size: 16px;
  font-weight: 800;
  color: var(--jp-on-primary);
  box-shadow: 0 4px 12px var(--jp-gold-border);
  flex-shrink: 0;
}

.dossier-name-block {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.dossier-title {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 800;
  color: var(--jp-text-emphasis);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dossier-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dossier-info-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-sm);
}

.dossier-info-row small {
  display: block;
  font-size: 9px;
  color: var(--jp-text-subtle);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.dossier-info-row strong {
  display: block;
  font-size: 11px;
  color: var(--jp-text-emphasis);
  margin-top: 1px;
  word-break: break-all;
}

.dossier-footer {
  margin-top: auto;
  flex-shrink: 0;
  padding-top: 10px;
  border-top: 1px solid var(--jp-border);
}

.empty-dossier {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 20px;
}

.dialog-header {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--jp-border);
}

.dialog-actions {
  padding: 10px 14px;
  border-top: 1px solid var(--jp-border);
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
