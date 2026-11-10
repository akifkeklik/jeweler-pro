<template>
  <div class="table-scroll-area pa-3">
    <div class="d-flex justify-space-between align-center mb-3">
      <div>
        <h3 class="font-weight-bold text-white">{{ $t('reports.gunlukKasaAltinKapanisi') }}</h3>
        <small class="text-disabled">{{ $t('reports.tarihP0', { p0: summary.date || $t('reports.bugun') }) }}</small>
      </div>
      <span class="jp-badge" :class="dayClosed ? 'jp-badge-success' : 'jp-badge-warning'">
        {{ dayClosed ? $t('reports.gunlukKapanisYapildiKilitli') : $t('reports.gunSonuKapanisiBekleniyor') }}
      </span>
    </div>

    <div class="closing-summary-grid mb-3">
      <div class="pa-2 rounded summary-tile">
        <small class="text-disabled">{{ $t('reports.gunIciSatisCirosu') }}</small>
        <div class="tabular font-weight-bold text-success">{{ tl(summary.totalSalesTry || 0) }}</div>
        <small class="text-disabled">{{ $t('reports.p0AdetSatis', { p0: summary.salesCount || 0 }) }}</small>
      </div>
      <div class="pa-2 rounded summary-tile">
        <small class="text-disabled">{{ $t('reports.nakitKasaSatisi') }}</small>
        <div class="tabular font-weight-bold text-white">{{ tl(summary.cashSalesTry || 0) }}</div>
        <small class="text-disabled">POS: {{ tl(summary.posSalesTry || 0) }}</small>
      </div>
      <div class="pa-2 rounded summary-tile">
        <small class="text-disabled">{{ $t('reports.tahsilatlar') }}</small>
        <div class="tabular font-weight-bold text-success">+{{ tl(summary.collectionsTry || 0) }}</div>
        <small class="text-disabled">{{ $t('reports.musteriOdemeleri') }}</small>
      </div>
      <div class="pa-2 rounded summary-tile">
        <small class="text-disabled">{{ $t('reports.odemelerGiderler') }}</small>
        <div class="tabular font-weight-bold text-danger">-{{ tl(summary.paymentsTry || 0) }}</div>
        <small class="text-disabled">{{ $t('reports.kasaCikislari') }}</small>
      </div>
    </div>

    <!-- Till reconciliation -->
    <div class="pa-3 rounded mb-3 reconcile-card">
      <div class="d-flex justify-space-between align-center mb-2">
        <span class="font-weight-bold text-white">{{ $t('reports.sistemHesaplananKasaNakitTutari') }}</span>
        <strong class="tabular font-weight-bold text-warning text-h6">{{ tl(summary.calculatedCash || 0) }}</strong>
      </div>
      <div class="text-caption text-disabled">
        {{ $t('reports.devredenKasaP0BugunkuNakit', { p0: tl(summary.openingCashTry || 0), p1: tl(summary.cashInTry || 0), p2: tl(summary.cashOutTry || 0), p3: summary.branch || '—' }) }}
      </div>

      <div class="d-flex gap-3 align-center mt-3">
        <div class="flex-1">
          <label class="form-label" for="closing-cash">{{ $t('reports.fiiliSayilanKasaNakit') }}</label>
          <input
            id="closing-cash"
            v-model.number="form.closingCashActual"
            type="number"
            step="0.01"
            :disabled="dayClosed"
            class="settings-input-full tabular"
            :placeholder="$t('reports.kasadaSayilanGercekTutar')"
          />
        </div>
        <div class="flex-1">
          <label class="form-label" for="closing-gold">{{ $t('reports.fiiliSayilanHasAltinGram') }}</label>
          <input
            id="closing-gold"
            v-model.number="form.closingGoldActual"
            type="number"
            step="0.001"
            :disabled="dayClosed"
            class="settings-input-full tabular"
            :placeholder="$t('reports.kasadaSayilanAltinGrami')"
          />
        </div>
      </div>

      <div class="d-flex justify-space-between align-center mt-3 pt-2 difference-row">
        <span class="text-caption text-disabled">{{ $t('reports.hesaplananKasaFarki') }}</span>
        <strong class="tabular font-weight-bold" :class="cashDiff >= 0 ? 'text-success' : 'text-danger'">
          {{ cashDiff >= 0 ? '+' : '' }}{{ tl(cashDiff) }}
          {{ cashDiff === 0 ? $t('reports.kasaTamMutabik') : (cashDiff > 0 ? $t('reports.kasaFazlasi') : $t('reports.kasaEksigi')) }}
        </strong>
      </div>

      <div class="d-flex justify-space-between align-center mt-1">
        <span class="text-caption text-disabled">{{ $t('reports.hesaplananHasAltinFarki') }}</span>
        <strong v-if="goldIsCounted" class="tabular font-weight-bold" :class="goldDiff >= 0 ? 'text-success' : 'text-danger'">
          {{ $t('reports.p0P1GrP2', { p0: goldDiff > 0 ? '+' : '', p1: $weight(goldDiff, 3), p2: goldDiff === 0 ? $t('reports.altinKasasiMutabik') : (goldDiff > 0 ? $t('reports.altinFazlasi') : $t('reports.altinEksigi')) }) }}
        </strong>
        <span v-else class="text-caption text-disabled">{{ $t('reports.altinSayilmadiFarkIslenmezAltin') }}</span>
      </div>
      <div class="text-caption text-disabled mt-1">
        {{ $t('reports.kapanistaNakitVeSayildiysaAltin') }}
      </div>

      <div class="mt-3">
        <label class="form-label" for="closing-notes">{{ $t('reports.kapanisMutabakatNotu') }}</label>
        <input
          id="closing-notes"
          v-model.trim="form.notes"
          type="text"
          :placeholder="$t('reports.ornAksamKasaSayimiEksiksiz')"
          class="settings-input-full"
        />
      </div>

      <div class="d-flex justify-end mt-3">
        <span v-if="!$can('cash:closing')" class="text-caption text-disabled align-self-center mr-2">
          {{ $t('reports.gunSonuKapanisiIcinCash') }}
        </span>
        <span v-if="dayClosed" class="text-caption text-disabled align-self-center mr-2">
          {{ $t('reports.bugununKasasiKilitliBuSubede') }}
        </span>
        <v-btn
          v-if="$can('cash:closing')"
          size="small"
          class="jp-primary"
          :loading="saving"
          :disabled="dayClosed"
          @click="submit"
        >
          <v-icon start size="14">mdi-lock-check</v-icon>
          {{ $t('reports.gunlukKapanisiOnaylaVeKilitle') }}
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import apiService from '@/services/api';
import { money, t } from '@/i18n';
import { cashDifference, closingPayload, goldCounted, goldDifference, type ClosingCount } from '@/services/dailyClosing';

interface Closing { isClosed?: boolean; closingCashActual?: number; closingGoldActual?: number; notes?: string }
interface DailySummary {
  date?: string;
  branch?: string;
  salesCount?: number;
  totalSalesTry?: number;
  cashSalesTry?: number;
  posSalesTry?: number;
  collectionsTry?: number;
  paymentsTry?: number;
  openingCashTry?: number;
  cashInTry?: number;
  cashOutTry?: number;
  calculatedCash?: number;
  calculatedGold?: number;
  closing?: Closing | null;
}

/**
 * Daily closing and Z report for the user's branch: the day's sales and cash
 * movements, the counted till against the expected cash and fine gold, and
 * the closing that locks the cash day.
 */
export default defineComponent({
  name: 'DailyClosingPanel',
  data: () => ({
    summary: {} as DailySummary,
    form: { closingCashActual: 0, closingGoldActual: 0, notes: '' } as ClosingCount,
    saving: false,
  }),
  computed: {
    dayClosed(): boolean {
      return Boolean(this.summary.closing?.isClosed);
    },
    cashDiff(): number {
      return cashDifference(this.form.closingCashActual, this.summary.calculatedCash);
    },
    goldIsCounted(): boolean {
      return goldCounted(this.form.closingGoldActual);
    },
    goldDiff(): number {
      return goldDifference(this.form.closingGoldActual, this.summary.calculatedGold);
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    tl(value: unknown) {
      if (value === null || value === undefined) return '—';
      return money(Number(value) || 0);
    },
    async load() {
      try {
        const data = await apiService.get<DailySummary>('/api/cash/daily-summary');
        this.summary = data || {};
        if (data?.closing?.isClosed) {
          this.form = {
            closingCashActual: data.closing.closingCashActual ?? 0,
            closingGoldActual: data.closing.closingGoldActual ?? 0,
            notes: data.closing.notes || '',
          };
        } else {
          this.form.closingCashActual = data?.calculatedCash || 0;
          this.form.closingGoldActual = data?.calculatedGold || 0;
        }
      } catch (err) {
        console.warn('Daily summary fetch warning:', err);
      }
    },
    async submit() {
      this.saving = true;
      try {
        await apiService.post('/api/cash/daily-closing', closingPayload(this.form));
        await this.load();
        this.$store.dispatch('notifications/showSuccess', t('reports.gunlukKapanisVeZRaporu'));
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('reports.kapanisKaydedilemediP0', { p0: (err as Error)?.message }));
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style scoped>
.table-scroll-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: auto;
}
.closing-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.summary-tile {
  background: var(--jp-surface-muted);
}
.reconcile-card {
  background: var(--jp-surface-card);
  border: 1px solid var(--jp-border);
}
.difference-row {
  border-top: 1px solid var(--jp-border);
}
</style>
