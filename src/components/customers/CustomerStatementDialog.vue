<template>
  <v-dialog v-model="open" max-width="720px">
    <v-card class="pa-3">
      <v-card-title class="dialog-header d-flex justify-space-between align-center">
        <div class="d-flex align-center">
          <v-icon size="18" color="info" class="mr-2">mdi-file-document-outline</v-icon>
          <span>{{ $t('customers.cariHesapEkstresiP0', { p0: customer?.name }) }}</span>
        </div>
        <v-btn icon size="x-small" variant="text" :aria-label="$t('common.close')" @click="open = false">
          <v-icon size="18">mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-card-text>
        <div v-if="loading" class="text-center py-6">
          <v-progress-circular indeterminate size="24" color="primary"></v-progress-circular>
          <div class="text-caption text-disabled mt-2">{{ $t('customers.cariKayitlarGetiriliyor') }}</div>
        </div>
        <div v-else>
          <div class="statement-summary">
            <div>
              <small class="text-disabled">{{ $t('customers.netTlBakiyesi') }}</small>
              <div class="tabular font-weight-bold" :class="statement.balanceTry >= 0 ? 'text-success' : 'text-danger'">
                {{ statement.balanceTry >= 0 ? '+' : '' }}{{ money(statement.balanceTry) }}
              </div>
            </div>
            <div class="ml-4">
              <small class="text-disabled">{{ $t('customers.netHasAltinBakiyesi') }}</small>
              <div class="tabular font-weight-bold" :class="statement.balanceGold >= 0 ? 'text-primary' : 'text-danger'">
                {{ $t('customers.p0P1GrHas', { p0: statement.balanceGold >= 0 ? '+' : '', p1: $weight(statement.balanceGold, 3) }) }}
              </div>
            </div>
          </div>

          <p v-if="statement.legacyHistory" class="text-caption text-disabled mb-2">
            {{ $t('customers.buMusterininYeniMuhasebeDefterinden') }}
          </p>
          <div class="statement-scroll" tabindex="0" role="region" :aria-label="$t('customers.cariHesapEkstresiP0', { p0: customer?.name })">
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
                <tr v-for="entry in statement.entries" :key="entry.id">
                  <td class="tabular text-caption text-disabled">{{ formatDate(entry.date) }}</td>
                  <td><span class="font-weight-medium" :title="entry.title">{{ $ledger(entry) }}</span></td>
                  <td class="text-right tabular font-weight-bold" :class="entry.direction === 'alacak' ? 'text-success' : 'text-danger'">
                    <template v-if="entry.amountTry">{{ entry.direction === 'alacak' ? '+' : '-' }}{{ money(entry.amountTry) }}</template>
                  </td>
                  <td class="text-right tabular" :class="entry.direction === 'alacak' ? 'text-success' : 'text-danger'">
                    <template v-if="entry.amountGold">{{ entry.direction === 'alacak' ? '+' : '-' }}{{ $weight(entry.amountGold, 3) }}</template>
                  </td>
                  <td class="text-right tabular" :class="(entry.balanceAfterTry || 0) >= 0 ? 'text-success' : 'text-danger'">
                    {{ money(entry.balanceAfterTry || 0) }}
                  </td>
                </tr>
                <tr v-if="!statement.entries.length">
                  <td colspan="5" class="empty-state-cell">{{ $t('customers.henuzBuCariyeAitHareket') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import apiService from '@/services/api';
import { dateTime, money, t } from '@/i18n';

interface StatementEntry {
  id: string;
  date: string;
  type?: string;
  title?: string;
  reference?: { id?: unknown };
  direction: 'alacak' | 'borc';
  amountTry?: number;
  amountGold?: number;
  balanceAfterTry?: number;
}
interface Statement { balanceTry: number; balanceGold: number; legacyHistory?: boolean; entries: StatementEntry[] }

const emptyStatement = (): Statement => ({ balanceTry: 0, balanceGold: 0, entries: [] });

/** Customer account statement (TRY and fine gold) from the ledger. */
export default defineComponent({
  name: 'CustomerStatementDialog',
  props: {
    modelValue: { type: Boolean, default: false },
    customer: { type: Object as PropType<{ _id: number; name: string } | null>, default: null },
  },
  emits: ['update:modelValue'],
  data: () => ({ loading: false, statement: emptyStatement() }),
  computed: {
    open: {
      get(): boolean { return this.modelValue; },
      set(value: boolean) { this.$emit('update:modelValue', value); },
    },
  },
  watch: {
    modelValue(value: boolean) {
      if (value) this.load();
    },
  },
  methods: {
    money(value: unknown) {
      return money(Number(value) || 0);
    },
    formatDate(value: string) {
      return dateTime(value);
    },
    async load() {
      if (!this.customer) return;
      this.loading = true;
      try {
        const data = await apiService.get<Statement>(`/api/cash/customer/${this.customer._id}/ledger`);
        this.statement = { ...emptyStatement(), ...(data || {}), entries: data?.entries || [] };
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('customers.ekstreAlinamadiP0', { p0: (err as Error)?.message }));
        this.statement = emptyStatement();
      } finally {
        this.loading = false;
      }
    },
  },
});
</script>

<style scoped src="@/styles/dialog.css"></style>

<style scoped>
.statement-summary {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  padding: 8px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-surface-muted);
}
.statement-scroll {
  max-height: 340px;
  overflow: auto;
}
.text-success { color: var(--jp-success); }
.text-danger { color: var(--jp-danger); }
.text-primary { color: var(--jp-primary); }
</style>
