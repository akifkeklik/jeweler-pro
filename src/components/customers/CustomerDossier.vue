<template>
  <div class="customer-dossier-card jp-card">
    <div v-if="customer" class="dossier-content">
      <div class="dossier-header">
        <div class="dossier-avatar-large">{{ getInitials(customer.name) }}</div>
        <div class="dossier-name-block">
          <h3 class="dossier-title">{{ customer.name }}</h3>
          <span class="jp-badge mt-1" :class="customer.customerType === 'kurumsal' ? 'jp-badge-gold' : 'jp-badge-info'">
            {{ customer.customerType === 'kurumsal' ? $t('customers.kurumsalCari') : $t('customers.bireyselCari') }}
          </span>
        </div>
      </div>

      <div class="dossier-body">
        <div class="dossier-info-row">
          <v-icon size="14" color="var(--jp-gold)">mdi-phone-outline</v-icon>
          <div>
            <small>{{ $t('customers.telefon2') }}</small>
            <strong>{{ customer.phone || $t('customers.kayitliTelefonYok') }}</strong>
          </div>
        </div>
        <div class="dossier-info-row">
          <v-icon size="14" color="var(--jp-gold)">mdi-email-outline</v-icon>
          <div>
            <small>{{ $t('customers.ePosta2') }}</small>
            <strong>{{ customer.email || $t('customers.kayitliEPostaYok') }}</strong>
          </div>
        </div>
        <div class="dossier-info-row">
          <v-icon size="14" color="var(--jp-gold)">mdi-map-marker-outline</v-icon>
          <div>
            <small>{{ $t('customers.adres') }}</small>
            <strong>{{ customer.address || $t('customers.kayitliAdresBilgisiYok') }}</strong>
          </div>
        </div>
        <!-- Cari Bakiye Şeridi -->
        <div class="dossier-balance-card mt-3 pa-3 rounded">
          <div class="d-flex justify-space-between align-center">
            <span class="text-caption text-disabled">{{ $t('customers.cariTlBakiyesi') }}</span>
            <strong
              class="tabular font-weight-bold"
              :class="(customer.balanceTry || 0) >= 0 ? 'text-success' : 'text-danger'"
            >
              {{ (customer.balanceTry || 0) >= 0 ? '+' : '' }}{{ money(customer.balanceTry || 0) }}
            </strong>
          </div>
          <div class="d-flex justify-space-between align-center mt-2">
            <span class="text-caption text-disabled">{{ $t('customers.hasAltinBakiyesi') }}</span>
            <strong
              class="tabular font-weight-bold"
              :class="(customer.balanceGold || 0) >= 0 ? 'text-primary' : 'text-danger'"
            >
              {{ $t('customers.p0P1GrHas', { p0: (customer.balanceGold || 0) >= 0 ? '+' : '', p1: $weight(customer.balanceGold || 0, 3) }) }}
            </strong>
          </div>
        </div>
      </div>

      <div class="dossier-footer">
        <v-btn
          block
          size="small"
          class="jp-primary mb-2"
          @click="$emit('sell', customer)"
        >
          <v-icon start size="14">mdi-lightning-bolt</v-icon>
          {{ $t('customers.buMusteriyeSatisBaslat') }}
        </v-btn>
        <v-btn
          block
          size="small"
          class="jp-secondary mb-2"
          @click="$emit('voucher')"
        >
          <v-icon start size="14">mdi-cash-plus</v-icon>
          {{ $t('customers.cariTahsilatOdemeYap') }}
        </v-btn>
        <v-btn
          block
          size="small"
          class="jp-secondary mb-2"
          @click="$emit('statement')"
        >
          <v-icon start size="14">mdi-file-document-outline</v-icon>
          {{ $t('customers.cariHesapEkstresi') }}
        </v-btn>
        <v-btn
          block
          size="small"
          class="jp-secondary"
          @click="$emit('edit', customer)"
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
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { money } from '@/i18n';

export interface DossierCustomer {
  _id: number;
  name: string;
  customerType?: 'bireysel' | 'kurumsal';
  phone?: string;
  email?: string;
  address?: string;
  balanceTry?: number;
  balanceGold?: number;
}

/** Selected customer's contact data, TRY and fine-gold balances and account actions. */
export default defineComponent({
  name: 'CustomerDossier',
  props: {
    customer: { type: Object as PropType<DossierCustomer | null>, default: null },
  },
  emits: ['sell', 'voucher', 'statement', 'edit'],
  methods: {
    money(value: unknown) {
      return money(Number(value) || 0);
    },
    getInitials(name?: string) {
      if (!name) return 'M';
      return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
    },
  },
});
</script>

<style scoped>
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
.dossier-balance-card {
  background: var(--jp-surface-muted);
  border: 1px solid var(--jp-border);
}
.text-success { color: var(--jp-success); }
.text-danger { color: var(--jp-danger); }
.text-primary { color: var(--jp-primary); }
</style>
