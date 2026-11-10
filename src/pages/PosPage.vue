<template>
  <div class="jp-page-shell ops-page-shell">
    <div class="jp-page-header">
      <div>
        <div class="jp-section-label">{{ $t('pos.kartTahsilatiBanka') }}</div>
        <h1 class="page-title"><v-icon size="20" color="primary">mdi-credit-card-check-outline</v-icon> {{ $t('pos.posHesapKesimi') }}</h1>
      </div>
      <div class="header-actions">
        <v-btn size="small" class="jp-secondary" :loading="loading" @click="load"><v-icon start size="14">mdi-refresh</v-icon>{{ $t('common.refresh') }}</v-btn>
        <v-btn v-if="tab === 'open' && $can('pos:settle')" size="small" class="jp-primary" :disabled="!selected.length" @click="openSettlement">
          <v-icon start size="14">mdi-bank-transfer-in</v-icon>{{ $t('pos.hesapKesimiP0', { p0: selected.length }) }}
        </v-btn>
        <v-btn v-if="tab === 'providers' && $can('pos:configure')" size="small" class="jp-primary" @click="openProvider(null)">
          <v-icon start size="14">mdi-plus</v-icon>{{ $t('pos.posEkle') }}
        </v-btn>
      </div>
    </div>

    <div class="summary-strip">
      <div v-for="row in summary" :key="`${row.providerCode}-${row.branch}`" class="summary-tile">
        <div class="tile-label">{{ row.providerCode || $t('pos.tanimsizPos') }} · {{ row.branch }}</div>
        <div class="tile-value tabular">{{ money(row.open) }}</div>
        <div class="tile-sub">{{ $t('pos.acikNetAlacakP0Islem', { p0: row.openItems }) }}<span v-if="row.overdueItems" class="text-warning"> {{ $t('pos.p0Gecikmis', { p0: row.overdueItems }) }}</span></div>
        <div class="tile-sub">{{ $t('pos.komisyonToplamiP0', { p0: money(row.commission) }) }}</div>
      </div>
      <div v-if="!summary.length && !loading" class="summary-tile empty">{{ $t('pos.henuzKartliTahsilatYok') }}</div>
    </div>

    <div class="ops-tabs">
      <button v-for="t in tabs" :key="t.id" type="button" class="ops-tab" :class="{ active: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
    </div>

    <div class="jp-card ops-card">
      <div v-if="loadError" class="ops-error">{{ loadError }}</div>

      <div v-if="tab === 'open'" class="table-scroll-wrap">
        <table class="jp-enterprise-table">
          <thead><tr><th style="width: 28px;"></th><th>{{ $t('pos.tarih') }}</th><th>POS</th><th>{{ $t('common.source') }}</th><th class="text-right">{{ $t('pos.taksit') }}</th><th class="text-right">{{ $t('pos.brut') }}</th><th class="text-right">{{ $t('pos.komisyon') }}</th><th class="text-right">{{ $t('common.net') }}</th><th class="text-right">{{ $t('pos.acik') }}</th><th>{{ $t('pos.valor') }}</th><th>{{ $t('common.status') }}</th></tr></thead>
          <tbody>
            <tr v-for="x in transactions" :key="x._id">
              <td><input v-if="$can('pos:settle')" v-model="selected" type="checkbox" :value="x._id" :disabled="!selectable(x)" /></td>
              <td class="tabular text-caption">{{ formatDate(x.capturedAt) }}</td>
              <td>{{ x.providerCode || $t('pos.tanimsiz') }}</td>
              <td class="text-caption">{{ x.kind === 'refund' ? $t('pos.iade') : '' }}{{ sourceLabel(x) }}</td>
              <td class="text-right tabular">{{ x.installments }}</td>
              <td class="text-right tabular">{{ money(x.gross) }}</td>
              <td class="text-right tabular">{{ x.commissionConfigured ? money(x.commission) : '—' }}<div v-if="x.ratePercent" class="text-caption text-disabled">{{ $t('pos.p0VP1', { p0: Number(x.ratePercent), p1: x.ruleVersion }) }}</div></td>
              <td class="text-right tabular">{{ money(x.net) }}</td>
              <td class="text-right tabular font-weight-bold">{{ money(x.open) }}</td>
              <td class="tabular text-caption" :class="{ 'text-warning': x.overdue }">{{ x.expectedSettlementDate ? formatDay(x.expectedSettlementDate) : '—' }}</td>
              <td><span class="jp-badge" :class="x.status === 'settled' ? 'jp-badge-success' : 'jp-badge-warning'">{{ statusLabel(x.status) }}</span></td>
            </tr>
            <tr v-if="!loading && !transactions.length"><td colspan="11" class="empty-table-state">{{ $t('pos.acikPosAlacagiYok') }}</td></tr>
          </tbody>
        </table>
        <p class="text-caption text-disabled mt-2">{{ $t('pos.basariliPosIslemiTahsilEdilmis') }}</p>
      </div>

      <div v-if="tab === 'settlements'" class="table-scroll-wrap">
        <table class="jp-enterprise-table">
          <thead><tr><th>{{ $t('pos.tarih') }}</th><th>{{ $t('common.branch') }}</th><th>{{ $t('common.receiptDoc') }}</th><th class="text-right">{{ $t('pos.islem') }}</th><th class="text-right">{{ $t('pos.beklenen') }}</th><th class="text-right">{{ $t('common.deposited') }}</th><th class="text-right">{{ $t('common.difference') }}</th><th>{{ $t('common.status') }}</th><th class="text-center" style="width: 80px;">{{ $t('pos.islem') }}</th></tr></thead>
          <tbody>
            <tr v-for="s in settlements" :key="s._id" :class="{ 'row-cancelled': s.status === 'reversed' }">
              <td class="tabular text-caption">{{ formatDay(s.settlementDate) }}</td>
              <td>{{ s.branch }}</td>
              <td class="text-caption">{{ s.bankReference || '—' }}</td>
              <td class="text-right tabular">{{ s.items }}</td>
              <td class="text-right tabular">{{ money(s.expected) }}</td>
              <td class="text-right tabular">{{ money(s.deposited) }}</td>
              <td class="text-right tabular" :class="{ 'text-warning': s.difference }">{{ money(s.difference) }}<div v-if="s.differenceResolution" class="text-caption text-disabled">{{ s.differenceResolution === 'commission' ? 'komisyon' : $t('pos.kesimFarki') }}</div></td>
              <td><span class="jp-badge" :class="s.status === 'posted' ? 'jp-badge-success' : 'jp-badge-danger'">{{ s.status === 'posted' ? $t('pos.kayitli') : $t('pos.tersKayit') }}</span></td>
              <td class="text-center">
                <v-btn v-if="s.status === 'posted' && $can('pos:settle')" icon size="x-small" variant="text" color="error" :title="$t('pos.tersKayit')" @click="reverse(s)"><v-icon size="15">mdi-undo-variant</v-icon></v-btn>
              </td>
            </tr>
            <tr v-if="!loading && !settlements.length"><td colspan="9" class="empty-table-state">{{ $t('pos.henuzHesapKesimiYok') }}</td></tr>
          </tbody>
        </table>
      </div>

      <div v-if="tab === 'providers'" class="table-scroll-wrap">
        <table class="jp-enterprise-table">
          <thead><tr><th>{{ $t('common.code') }}</th><th>{{ $t('common.name') }}</th><th>{{ $t('pos.subeler') }}</th><th>{{ $t('pos.kurallarTaksitOranUcretValor') }}</th><th>{{ $t('pos.iadedeKomisyon') }}</th><th class="text-right">{{ $t('pos.surum') }}</th><th>{{ $t('common.status') }}</th><th class="text-center" style="width: 70px;"></th></tr></thead>
          <tbody>
            <tr v-for="p in providers" :key="p._id">
              <td class="font-weight-bold">{{ p.code }}</td>
              <td>{{ p.name }}</td>
              <td class="text-caption">{{ p.branches.length ? p.branches.join(', ') : $t('pos.tumSubeler') }}</td>
              <td class="text-caption tabular">{{ p.rules.map((r) => $t('pos.ruleText', { installments: r.installments, rate: $n(r.ratePercent), fee: $money(r.fixedFee), days: r.valorDays })).join(' · ') }}</td>
              <td class="text-caption">{{ p.refundCommissionPolicy === 'reversed' ? $t('pos.bankaIadeEder') : $t('pos.bankaTutar') }}</td>
              <td class="text-right tabular">{{ $t('pos.vP0', { p0: p.version }) }}</td>
              <td><span class="jp-badge" :class="p.active ? 'jp-badge-success' : 'jp-badge-neutral'">{{ p.active ? $t('common.active') : $t('common.inactive') }}</span></td>
              <td class="text-center"><v-btn v-if="$can('pos:configure')" icon size="x-small" variant="text" color="info" :title="$t('common.edit')" @click="openProvider(p)"><v-icon size="15">mdi-pencil-outline</v-icon></v-btn></td>
            </tr>
            <tr v-if="!loading && !providers.length"><td colspan="8" class="empty-table-state">{{ $t('pos.posSaglayicisiTanimliDegilKartli') }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- SETTLEMENT -->
    <v-dialog v-model="settlementDialog" max-width="520px" persistent>
      <v-card class="pa-2">
        <v-card-title class="dialog-header"><v-icon size="18" color="success" class="mr-2">mdi-bank-transfer-in</v-icon>{{ $t('pos.hesapKesimiBankaYatisi') }}</v-card-title>
        <v-card-text>
          <div class="text-caption mb-2">{{ $t('pos.p0IslemPos', { p0: selected.length }) }} <strong>{{ settlementProviderLabel }}</strong> {{ $t('pos.beklenenNet') }} <strong class="tabular">{{ money(expectedTotal) }}</strong></div>
          <div v-if="mixedSelection" class="ops-error">{{ $t('pos.birHesapKesimindeYalnizcaAyni') }}</div>
          <div class="form-grid-2">
            <div><label class="form-label">{{ $t('pos.bankayaYatanTutar') }}</label><input v-model.trim="settle.deposited" type="text" inputmode="decimal" class="form-input-full tabular" /></div>
            <div><label class="form-label">{{ $t('pos.valorTarihi') }}</label><input v-model="settle.date" type="date" class="form-input-full" /></div>
          </div>
          <div class="form-grid-2 mt-2">
            <div><label class="form-label">{{ $t('pos.dekontReferans') }}</label><input v-model.trim="settle.reference" type="text" maxlength="80" class="form-input-full" /></div>
            <div>
              <label class="form-label">{{ $t('pos.farkCozumuFarkVarsa') }}</label>
              <select v-model="settle.resolution" class="form-select-full">
                <option value="">{{ $t('pos.farkYok') }}</option>
                <option value="commission">{{ $t('pos.komisyonDuzeltmesi') }}</option>
                <option value="settlement_difference">{{ $t('pos.hesapKesimFarkiIncelenecek') }}</option>
              </select>
            </div>
          </div>
          <!-- Refunds ≥ captures: the bank debits the account (negative) or nothing moves (0). -->
          <p v-if="expectedTotal <= 0" class="text-caption mt-2">{{ $t(expectedTotal < 0 ? 'pos.negativeSettlementHint' : 'pos.nettedSettlementHint') }}</p>
          <p class="text-caption text-disabled mt-2">{{ $t('pos.farkVeMuhasebeKaydiSunucuda') }}</p>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" :disabled="saving" @click="settlementDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn size="small" class="jp-primary" :loading="saving" :disabled="mixedSelection || !isValidSignedAmount(settle.deposited, 2, { allowZero: expectedTotal === 0 })" @click="submitSettlement">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- PROVIDER -->
    <v-dialog v-model="providerDialog" max-width="640px" persistent>
      <v-card class="pa-2">
        <v-card-title class="dialog-header"><v-icon size="18" color="primary" class="mr-2">mdi-credit-card-settings-outline</v-icon>{{ providerForm._id ? $t('pos.posDuzenle') : $t('pos.yeniPosBanka') }}</v-card-title>
        <v-card-text>
          <div class="form-grid-2">
            <div><label class="form-label">{{ $t('pos.kod') }}</label><input v-model.trim="providerForm.code" :disabled="Boolean(providerForm._id)" type="text" maxlength="40" class="form-input-full" /></div>
            <div><label class="form-label">{{ $t('pos.ad') }}</label><input v-model.trim="providerForm.name" type="text" maxlength="120" class="form-input-full" /></div>
          </div>
          <div class="form-grid-2 mt-2">
            <div>
              <label class="form-label">{{ $t('pos.iadedeKomisyon2') }}</label>
              <select v-model="providerForm.refundCommissionPolicy" class="form-select-full">
                <option value="retained">{{ $t('pos.bankaKomisyonuTutar') }}</option>
                <option value="reversed">{{ $t('pos.bankaKomisyonuOransalIadeEder') }}</option>
              </select>
            </div>
            <div v-if="providerForm._id"><label class="form-label">{{ $t('common.status') }}</label><select v-model="providerForm.active" class="form-select-full"><option :value="true">{{ $t('common.active') }}</option><option :value="false">{{ $t('common.inactive') }}</option></select></div>
          </div>
          <div class="line-box mt-3">
            <div class="rule-row rule-head"><span>{{ $t('pos.taksit2') }}</span><span>{{ $t('pos.oran') }}</span><span>{{ $t('pos.sabitUcretTl') }}</span><span>{{ $t('pos.valorGun') }}</span><span></span></div>
            <div v-for="(r, i) in providerForm.rules" :key="r.key" class="rule-row">
              <input v-model.number="r.installments" type="number" min="1" max="36" class="form-input-full tabular" />
              <input v-model.trim="r.ratePercent" type="text" inputmode="decimal" class="form-input-full tabular" />
              <input v-model.trim="r.fixedFee" type="text" inputmode="decimal" class="form-input-full tabular" />
              <input v-model.number="r.valorDays" type="number" min="0" class="form-input-full tabular" />
              <v-btn icon size="x-small" variant="text" color="error" :disabled="providerForm.rules.length === 1" @click="providerForm.rules.splice(i, 1)"><v-icon size="15">mdi-close</v-icon></v-btn>
            </div>
            <v-btn size="x-small" variant="text" color="primary" @click="providerForm.rules.push(rule())"><v-icon start size="14">mdi-plus</v-icon> {{ $t('pos.kuralEkle') }}</v-btn>
          </div>
          <p class="text-caption text-disabled mt-2">{{ $t('pos.oranDegisikligiYeniBirSurum') }}</p>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" :disabled="saving" @click="providerDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn size="small" class="jp-primary" :loading="saving" :disabled="!providerForm.code || !providerForm.name" @click="saveProvider">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { translatedLabels } from '@/services/finance';
import { date, dateTime, t } from '@/i18n';
import { promptAction } from '@/services/confirm';
import apiService from '@/services/api';
import {
  formatTry, errorMessage, newIdempotencyKey, normalizeDecimalInput, isValidSignedAmount,
} from '@/services/finance';
import { POS_STATUS_LABELS } from '@/services/operations';

let seq = 0;
const rule = (r = {}) => ({ key: `r${(seq += 1)}`, installments: r.installments ?? 1, ratePercent: r.ratePercent ?? '', fixedFee: r.fixedFee ?? '0', valorDays: r.valorDays ?? 1 });
// Translated on read so labels follow language changes.
const SOURCE_LABELS = translatedLabels('pos.source');

export default {
  name: 'PosPage',
  data() {
    return {
      tab: 'open',
      loading: false,
      saving: false,
      loadError: '',
      summary: [],
      transactions: [],
      settlements: [],
      providers: [],
      selected: [],
      settlementDialog: false,
      settle: { deposited: '', date: '', reference: '', resolution: '', key: '' },
      providerDialog: false,
      providerForm: { rules: [rule()] },
    };
  },
  computed: {
    tabs() {
      return [{ id: 'open', label: t('pos.acikPosAlacaklari') }, { id: 'settlements', label: t('pos.hesapKesimleri') }, { id: 'providers', label: t('pos.posSaglayicilari') }];
    },
    selectedRows() {
      return this.transactions.filter((t) => this.selected.includes(t._id));
    },
    mixedSelection() {
      return new Set(this.selectedRows.map((t) => `${t.providerId || 'none'}|${t.branch}`)).size > 1;
    },
    expectedTotal() {
      // Display only (kuruş-exact sum); the server recomputes everything.
      return this.selectedRows.reduce((s, t) => s + Math.round(t.open * 100), 0) / 100;
    },
    settlementProviderLabel() {
      return this.selectedRows[0]?.providerCode || t('pos.tanimsiz');
    },
  },
  watch: {
    tab() { this.load(); },
  },
  mounted() {
    this.load();
  },
  methods: {
    rule,
    isValidSignedAmount,
    money: formatTry,
    statusLabel: (s) => POS_STATUS_LABELS[s] || s,
    sourceLabel: (x) => `${SOURCE_LABELS[x.source] || x.source || ''}${x.reference?.id ? ` #${x.reference.id}` : ''}`,
    selectable: (x) => x.status !== 'settled' && x.open !== 0,
    formatDate: (v) => dateTime(v),
    formatDay: (v) => date(v),
    async load() {
      this.loading = true;
      this.loadError = '';
      try {
        this.summary = (await apiService.get('/api/pos/summary')) || [];
        if (this.tab === 'open') {
          this.transactions = (await apiService.get('/api/pos/transactions?status=unsettled')) || [];
          this.selected = this.selected.filter((id) => this.transactions.some((t) => t._id === id));
        } else if (this.tab === 'settlements') {
          this.settlements = (await apiService.get('/api/pos/settlements')) || [];
        } else {
          this.providers = (await apiService.get('/api/pos/providers')) || [];
        }
      } catch (err) {
        this.loadError = t('pos.verilerYuklenemediP0', { p0: errorMessage(err) });
      } finally {
        this.loading = false;
      }
    },
    openSettlement() {
      this.settle = { deposited: this.expectedTotal.toFixed(2), date: new Date().toISOString().slice(0, 10), reference: '', resolution: '', key: newIdempotencyKey('posset') };
      this.settlementDialog = true;
    },
    async submitSettlement() {
      const first = this.selectedRows[0];
      const payload = {
        providerId: first.providerId || null,
        branch: first.branch,
        settlementDate: this.settle.date,
        depositedAmount: normalizeDecimalInput(this.settle.deposited),
        bankReference: this.settle.reference || undefined,
        allocations: this.selected.map((id) => ({ posTransactionId: id })),
        ...(this.settle.resolution ? { differenceResolution: this.settle.resolution } : {}),
      };
      this.saving = true;
      try {
        await apiService.post('/api/pos/settlements', payload, { headers: { 'Idempotency-Key': this.settle.key } });
        this.settlementDialog = false;
        this.selected = [];
        this.$store.dispatch('notifications/showSuccess', t('pos.hesapKesimiKaydedildiPosAlacagi'));
        await this.load();
      } catch (err) {
        this.$store.dispatch('notifications/showError', errorMessage(err));
      } finally {
        this.saving = false;
      }
    },
    async reverse(s) {
      const reason = await promptAction({
        title: t('pos.reverseTitle'),
        message: t('pos.reverseMessage'),
        inputLabel: t('pos.reverseReason'),
        confirmLabel: t('pos.tersKayit'),
        tone: 'warning',
      });
      if (!reason) return;
      try {
        await apiService.post(`/api/pos/settlements/${s._id}/reverse`, { reason });
        this.$store.dispatch('notifications/showSuccess', t('pos.hesapKesimiTersKaydaAlindi'));
        await this.load();
      } catch (err) {
        this.$store.dispatch('notifications/showError', errorMessage(err));
      }
    },
    openProvider(p) {
      this.providerForm = p
        ? { _id: p._id, code: p.code, name: p.name, active: p.active, refundCommissionPolicy: p.refundCommissionPolicy, rules: p.rules.map((r) => rule(r)) }
        : { code: '', name: '', refundCommissionPolicy: 'retained', rules: [rule()] };
      this.providerDialog = true;
    },
    async saveProvider() {
      const f = this.providerForm;
      const body = {
        name: f.name,
        refundCommissionPolicy: f.refundCommissionPolicy,
        rules: f.rules.map((r) => ({ installments: Number(r.installments), ratePercent: normalizeDecimalInput(r.ratePercent) || '0', fixedFee: normalizeDecimalInput(r.fixedFee) || '0', valorDays: Number(r.valorDays) || 0 })),
      };
      this.saving = true;
      try {
        if (f._id) await apiService.put(`/api/pos/providers/${f._id}`, { ...body, active: f.active });
        else await apiService.post('/api/pos/providers', { ...body, code: f.code });
        this.providerDialog = false;
        this.$store.dispatch('notifications/showSuccess', t('pos.posTanimiKaydedildi'));
        await this.load();
      } catch (err) {
        this.$store.dispatch('notifications/showError', errorMessage(err));
      } finally {
        this.saving = false;
      }
    },
  },
};
</script>

<style scoped>
.ops-page-shell { display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; }
.header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.summary-strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; flex-shrink: 0; }
.summary-tile { background: var(--jp-surface); border: 1px solid var(--jp-border); border-radius: var(--jp-radius-sm); padding: 8px 10px; }
.summary-tile.empty { color: var(--jp-text-subtle); font-size: 12px; }
.tile-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--jp-text-subtle); }
.tile-value { font-size: 18px; font-weight: 700; color: var(--jp-gold); }
.tile-sub { font-size: 11px; color: var(--jp-text-muted); }
.ops-tabs { display: flex; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
.ops-tab { font-size: 12px; padding: 5px 12px; border-radius: var(--jp-radius-sm); border: 1px solid var(--jp-border); background: var(--jp-surface); color: var(--jp-text-muted); cursor: pointer; }
.ops-tab.active { color: var(--jp-gold); border-color: var(--jp-gold-border); background: var(--jp-gold-subtle); }
.ops-card { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; padding: 8px 12px; }
.ops-error { color: var(--jp-danger); font-size: 12px; padding: 4px 0; }
.table-scroll-wrap { flex: 1; min-height: 0; overflow: auto; }
.empty-table-state { text-align: center; padding: 24px 0 !important; color: var(--jp-text-subtle); font-size: 12px; }
.row-cancelled td { opacity: 0.55; }
.text-warning { color: var(--jp-warning); }
.dialog-header { display: flex; align-items: center; font-size: 14px; font-weight: 700; padding-bottom: 6px; border-bottom: 1px solid var(--jp-border); }
.dialog-actions { border-top: 1px solid var(--jp-border); padding-top: 8px; }
.form-label { font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--jp-text-subtle); margin-bottom: 4px; display: block; }
.form-select-full, .form-input-full { width: 100%; height: 32px; padding: 0 8px; font-size: 12px; border: 1px solid var(--jp-border); border-radius: var(--jp-radius-sm); background: var(--jp-surface); color: var(--jp-text); outline: none; }
.form-select-full:focus, .form-input-full:focus { border-color: var(--jp-gold); }
.form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.line-box { border: 1px solid var(--jp-border); border-radius: var(--jp-radius-sm); padding: 8px; background: var(--jp-surface-muted); }
.rule-row { display: grid; grid-template-columns: 70px 1fr 1fr 90px 28px; gap: 6px; align-items: center; margin-bottom: 6px; }
.rule-head { font-size: 10px; text-transform: uppercase; color: var(--jp-text-subtle); }
@media (max-width: 900px) { .form-grid-2 { grid-template-columns: 1fr; } }
</style>
