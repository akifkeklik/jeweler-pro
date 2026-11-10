<template>
  <div class="jp-page-shell ops-page-shell">
    <div class="jp-page-header">
      <div>
        <div class="jp-section-label">{{ $t('transfers.subelerArasiStok') }}</div>
        <h1 class="page-title"><v-icon size="20" color="primary">mdi-truck-fast-outline</v-icon> {{ $t('transfers.transferler') }}</h1>
      </div>
      <div class="header-actions">
        <v-btn size="small" class="jp-secondary" :loading="loading" @click="load"><v-icon start size="14">mdi-refresh</v-icon>{{ $t('common.refresh') }}</v-btn>
        <v-btn v-if="$can('transfers:write')" size="small" class="jp-primary" :disabled="branches.length < 2" @click="openCreate">
          <v-icon start size="14">mdi-plus</v-icon>{{ $t('transfers.yeniTransfer') }}
        </v-btn>
      </div>
    </div>

    <div class="ops-tabs">
      <button v-for="f in filters" :key="f.id" type="button" class="ops-tab" :class="{ active: filter === f.id }" @click="filter = f.id">
        {{ f.label }} <span class="tab-count">{{ counts[f.id] }}</span>
      </button>
    </div>

    <div class="jp-card ops-card">
      <div v-if="loadError" class="ops-error">{{ loadError }}</div>
      <div v-else-if="branches.length < 2 && !loading" class="ops-hint">
        {{ $t('transfers.transferIcinIsletmedeEnAz') }} <strong>{{ currentBranch || '—' }}</strong>
      </div>
      <div class="table-scroll-wrap">
        <table class="jp-enterprise-table">
          <thead>
            <tr><th>{{ $t('common.number') }}</th><th>{{ $t('transfers.guzergah') }}</th><th>{{ $t('transfers.kalemler') }}</th><th>{{ $t('common.status') }}</th><th class="text-right">{{ $t('transfers.olusturma') }}</th><th class="text-center" style="width: 90px;">{{ $t('common.details') }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="t in visible" :key="t._id" class="clickable" @click="openDetail(t)">
              <td class="tabular text-caption font-weight-bold">#{{ t._id }}</td>
              <td>{{ t.sourceBranch }} <v-icon size="12">mdi-arrow-right</v-icon> {{ t.destinationBranch }}</td>
              <td class="text-caption">{{ lineSummary(t) }}</td>
              <td><span class="jp-badge" :class="badge(t.status)">{{ statusLabel(t.status) }}</span></td>
              <td class="text-right tabular text-caption text-disabled">{{ formatDate(t.createdAt) }}</td>
              <td class="text-center"><v-btn icon size="x-small" variant="text" color="info" :title="$t('transfers.detay')" @click.stop="openDetail(t)"><v-icon size="15">mdi-eye-outline</v-icon></v-btn></td>
            </tr>
            <tr v-if="!loading && !visible.length"><td colspan="6" class="empty-table-state">{{ $t('transfers.buFiltredeTransferYok') }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- CREATE -->
    <v-dialog v-model="createDialog" max-width="760px" persistent>
      <v-card class="pa-2">
        <v-card-title class="dialog-header"><v-icon size="18" color="primary" class="mr-2">mdi-truck-plus-outline</v-icon>{{ $t('transfers.yeniTransferTaslagi') }}</v-card-title>
        <v-card-text>
          <div class="form-grid-2">
            <div><label class="form-label" for="transferspage-f1">{{ $t('transfers.kaynakSube') }}</label><input id="transferspage-f1" :value="currentBranch" disabled class="form-input-full" /></div>
            <div>
              <label class="form-label" for="transferspage-f2">{{ $t('transfers.hedefSube') }}</label>
              <select id="transferspage-f2" v-model="form.destinationBranch" class="form-select-full">
                <option value="" disabled>{{ $t('common.select') }}</option>
                <option v-for="b in destinationOptions" :key="b" :value="b">{{ b }}</option>
              </select>
            </div>
          </div>
          <div class="line-box mt-3">
            <div v-for="(line, index) in form.lines" :key="line.key" class="line-row">
              <select v-model="line.kind" class="form-select-full">
                <option value="product">{{ $t('common.product') }}</option>
                <option value="metal">{{ $t('transfers.madenHasHurda') }}</option>
              </select>
              <template v-if="line.kind === 'product'">
                <select v-model="line.productId" class="form-select-full">
                  <option value="" disabled>{{ $t('transfers.urunSecin') }}</option>
                  <option v-for="p in sourceProducts" :key="p._id" :value="p._id">{{ $t('transfers.p0SerbestP1', { p0: p.name, p1: freeStock(p) }) }}</option>
                </select>
                <input v-model.number="line.quantity" type="number" min="1" :placeholder="$t('common.quantity')" class="form-input-full tabular text-right" />
              </template>
              <template v-else>
                <select v-model="line.pool" class="form-select-full">
                  <option value="" disabled>{{ $t('transfers.havuzSecin') }}</option>
                  <option v-for="m in sourcePools" :key="`${m.metal}-${m.purity}`" :value="`${m.metal}|${m.purity}`">{{ $t('transfers.p0P1P2Gr', { p0: m.metal, p1: purityText(m.purity), p2: $weight(m.weightGrams, 3) }) }}</option>
                </select>
                <input v-model.trim="line.weightGrams" type="text" inputmode="decimal" :placeholder="$t('transfers.gram')" class="form-input-full tabular text-right" />
              </template>
              <v-btn icon size="x-small" variant="text" color="error" :disabled="form.lines.length === 1" @click="form.lines.splice(index, 1)"><v-icon size="15">mdi-close</v-icon></v-btn>
            </div>
            <v-btn size="x-small" variant="text" color="primary" @click="form.lines.push(newLine())"><v-icon start size="14">mdi-plus</v-icon> {{ $t('transfers.satirEkle') }}</v-btn>
          </div>
          <div class="mt-3"><label class="form-label" for="transferspage-f3">{{ $t('common.note') }}</label><input id="transferspage-f3" v-model.trim="form.notes" type="text" maxlength="300" class="form-input-full" /></div>
          <p class="text-caption text-disabled mt-2">
            {{ $t('transfers.taslakStokAyirmazOnayKaynak') }}
          </p>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-spacer></v-spacer>
          <v-btn size="small" class="jp-secondary" :disabled="saving" @click="createDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn size="small" class="jp-primary" :loading="saving" :disabled="!canCreate" @click="create">{{ $t('transfers.taslakOlustur') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- DETAIL -->
    <v-dialog v-model="detailDialog" max-width="900px">
      <v-card v-if="detail" class="pa-2">
        <v-card-title class="dialog-header">
          <v-icon size="18" color="primary" class="mr-2">mdi-truck-outline</v-icon>
          {{ $t('transfers.transferP0P1P2', { p0: detail._id, p1: detail.sourceBranch, p2: detail.destinationBranch }) }}
          <v-spacer></v-spacer>
          <span class="jp-badge" :class="badge(detail.status)">{{ statusLabel(detail.status) }}</span>
        </v-card-title>
        <v-card-text>
          <div class="table-scroll-wrap" style="max-height: 260px;">
            <table class="jp-enterprise-table">
              <thead>
                <tr><th>{{ $t('common.item') }}</th><th class="text-right">{{ $t('common.requested') }}</th><th class="text-right">{{ $t('common.dispatched') }}</th><th class="text-right">{{ $t('transfers.teslim') }}</th><th class="text-right">{{ $t('transfers.iade') }}</th><th class="text-right">{{ $t('transfers.fire') }}</th><th class="text-right">{{ $t('transfers.bekleyen') }}</th><th v-if="actions.receive || actions.resolve" class="text-right" style="width: 110px;">{{ $t('transfers.miktar') }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="l in detail.lines" :key="l.lineId">
                  <td>{{ l.itemType === 'metal' ? `${l.metal} ${purityText(l.purity)}` : l.productName }}</td>
                  <td class="text-right tabular">{{ amountText(l, l) }}</td>
                  <td class="text-right tabular">{{ l.dispatched ? amountText(l, l.dispatched) : '—' }}<div v-if="l.dispatched && l.dispatched.cost !== null" class="text-caption text-disabled">{{ money(l.dispatched.cost) }}</div></td>
                  <td class="text-right tabular">{{ amountText(l, l.received) }}</td>
                  <td class="text-right tabular">{{ amountText(l, l.returned) }}</td>
                  <td class="text-right tabular">{{ amountText(l, l.writtenOff) }}</td>
                  <td class="text-right tabular" :class="{ 'text-warning font-weight-bold': hasOutstanding(l) }">{{ l.outstanding ? amountText(l, l.outstanding) : '—' }}</td>
                  <td v-if="actions.receive || actions.resolve" class="text-right">
                    <input v-model.trim="amounts[l.lineId]" :disabled="!hasOutstanding(l)" type="text" inputmode="decimal" :placeholder="l.itemType === 'metal' ? 'gr' : 'adet'" class="form-input-full tabular text-right" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="actions.receive || actions.resolve" class="text-caption text-disabled mt-1">{{ $t('transfers.miktarBosBirakilanSatirlarIsleme') }}</p>

          <div v-if="actions.resolve || actions.reject || actions.cancel" class="form-grid-2 mt-3">
            <div v-if="actions.resolve">
              <label class="form-label" for="transferspage-f4">{{ $t('transfers.farkCozumu') }}</label>
              <select id="transferspage-f4" v-model="resolution" class="form-select-full">
                <option value="return_to_source">{{ $t('transfers.kaynakSubeyeIadeStokGeri') }}</option>
                <option value="write_off">{{ $t('transfers.kayipFireGiderYazilir') }}</option>
              </select>
            </div>
            <div><label class="form-label" for="transferspage-f5">{{ $t('transfers.gerekceRetIptalVeFark') }}</label><input id="transferspage-f5" v-model.trim="reason" type="text" maxlength="300" class="form-input-full" /></div>
          </div>

          <div class="detail-grid mt-3">
            <div class="detail-box">
              <strong>{{ $t('transfers.gecmis') }}</strong>
              <ul class="event-list">
                <li v-for="(e, i) in detail.events" :key="i">
                  <span class="tabular text-disabled">{{ formatDate(e.at) }}</span> — {{ eventLabel(e.action) }}<span v-if="e.note">: {{ e.note }}</span>
                </li>
              </ul>
            </div>
            <div class="detail-box">
              <strong>{{ $t('transfers.muhasebeKayitlari') }}</strong>
              <ul class="event-list">
                <li v-for="j in detail.journal || []" :key="j._id">
                  {{ j.description }}
                  <div v-for="(ln, k) in j.lines" :key="k" class="text-caption tabular">{{ ln.account }}: {{ ln.debit ? `B ${money(ln.debit)}` : `A ${money(ln.credit)}` }}</div>
                </li>
                <li v-if="!(detail.journal || []).length" class="text-disabled">{{ $t('transfers.henuzMuhasebeKaydiYokSevk') }}</li>
              </ul>
            </div>
          </div>
        </v-card-text>
        <v-card-actions class="dialog-actions">
          <v-btn v-if="actions.reject" size="small" class="jp-secondary" :loading="saving" :disabled="!reason" @click="act('reject', { reason })">{{ $t('transfers.reddet') }}</v-btn>
          <v-btn v-if="actions.cancel" size="small" class="jp-secondary" :loading="saving" :disabled="!reason" @click="act('cancel', { reason })">{{ $t('transfers.iptalEt') }}</v-btn>
          <v-spacer></v-spacer>
          <v-btn v-if="actions.approve" size="small" class="jp-primary" :loading="saving" @click="act('approve', {})">{{ $t('transfers.onaylaStoguAyir') }}</v-btn>
          <v-btn v-if="actions.dispatch" size="small" class="jp-primary" :loading="saving" @click="act('dispatch', {}, true)">{{ $t('transfers.sevkEt') }}</v-btn>
          <v-btn v-if="actions.receive" size="small" class="jp-primary" :loading="saving" :disabled="!receiptLines.length" @click="act('receive', { lines: receiptLines }, true)">{{ $t('transfers.teslimAl') }}</v-btn>
          <v-btn v-if="actions.resolve" size="small" class="jp-secondary" :loading="saving" :disabled="!reason" @click="resolveShortfall">{{ $t('transfers.farkiKapat') }}</v-btn>
          <v-btn size="small" class="jp-secondary" @click="detailDialog = false">{{ $t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { dateTime, n, t } from '@/i18n';
import apiService from '@/services/api';
import { getCurrentUser } from '@/services/authSession';
import {
  formatTry, purityLabel, errorMessage, newIdempotencyKey, normalizeDecimalInput,
} from '@/services/finance';
import { formatGrams } from '@/services/finance';
import {
  TRANSFER_STATUS_LABELS, TRANSFER_STATUS_BADGES, TRANSFER_EVENT_LABELS, transferActions, buildReceiptLines,
} from '@/services/operations';

let seq = 0;
const newLine = () => ({ key: `t${(seq += 1)}`, kind: 'product', productId: '', quantity: 1, pool: '', weightGrams: '' });

export default {
  name: 'TransfersPage',
  data() {
    return {
      loading: false,
      saving: false,
      loadError: '',
      transfers: [],
      branches: [],
      currentBranch: '',
      products: [],
      pools: [],
      filter: 'open',
      createDialog: false,
      form: { destinationBranch: '', lines: [newLine()], notes: '', key: '' },
      detailDialog: false,
      detail: null,
      amounts: {},
      reason: '',
      resolution: 'return_to_source',
      commandKey: '',
    };
  },
  computed: {
    filters() {
      return [
        { id: 'open', label: t('transfers.acik') },
        { id: 'incoming', label: t('transfers.gelen') },
        { id: 'outgoing', label: t('transfers.giden') },
        { id: 'all', label: t('common.all') },
      ];
    },
    counts() {
      const out = { open: 0, incoming: 0, outgoing: 0, all: this.transfers.length };
      for (const t of this.transfers) {
        if (!['received', 'cancelled', 'rejected'].includes(t.status)) out.open += 1;
        if (t.destinationBranch === this.currentBranch) out.incoming += 1;
        if (t.sourceBranch === this.currentBranch) out.outgoing += 1;
      }
      return out;
    },
    visible() {
      return this.transfers.filter((t) => {
        if (this.filter === 'open') return !['received', 'cancelled', 'rejected'].includes(t.status);
        if (this.filter === 'incoming') return t.destinationBranch === this.currentBranch;
        if (this.filter === 'outgoing') return t.sourceBranch === this.currentBranch;
        return true;
      });
    },
    destinationOptions() {
      return this.branches.filter((b) => b !== this.currentBranch);
    },
    sourceProducts() {
      return this.products.filter((p) => p.branch === this.currentBranch && this.freeStock(p) > 0);
    },
    sourcePools() {
      return this.pools.filter((p) => p.branch === this.currentBranch && p.weightGrams > 0);
    },
    canCreate() {
      return Boolean(this.form.destinationBranch) && this.form.lines.length > 0 && this.form.lines.every((l) => (l.kind === 'product'
        ? l.productId && Number(l.quantity) > 0
        : l.pool && normalizeDecimalInput(l.weightGrams)));
    },
    actions() {
      if (!this.detail) return {};
      const user = getCurrentUser() || {};
      return transferActions(this.detail, { permissions: user.permissions || [], branch: user.branch, role: user.role, id: user.id });
    },
    receiptLines() {
      return this.detail ? buildReceiptLines(this.detail.lines, this.amounts) : [];
    },
  },
  mounted() {
    this.load();
  },
  methods: {
    newLine,
    money: formatTry,
    purityText: purityLabel,
    statusLabel: (s) => TRANSFER_STATUS_LABELS[s] || s,
    badge: (s) => TRANSFER_STATUS_BADGES[s] || 'jp-badge-neutral',
    eventLabel: (a) => TRANSFER_EVENT_LABELS[a] || a,
    freeStock: (p) => (p.stock || 0) - (p.reservedStock || 0),
    formatDate(value) {
      return dateTime(value);
    },
    lineSummary(transfer) {
      return transfer.lines.map((l) => (l.itemType === 'metal' ? `${l.metal} ${formatGrams(l.weightGrams)}` : `${l.productName} × ${n(l.quantity)}`)).join(', ');
    },
    amountText(line, q) {
      if (!q) return '—';
      return line.itemType === 'metal' ? formatGrams(q.weightGrams || 0) : n(q.quantity || 0);
    },
    hasOutstanding(l) {
      return Boolean(l.outstanding && (l.outstanding.quantity > 0 || l.outstanding.weightGrams > 0));
    },
    async load() {
      this.loading = true;
      this.loadError = '';
      try {
        const [transfers, branchInfo] = await Promise.all([apiService.get('/api/transfers'), apiService.get('/api/transfers/branches')]);
        this.transfers = transfers || [];
        this.branches = branchInfo?.branches || [];
        this.currentBranch = branchInfo?.current || '';
      } catch (err) {
        this.loadError = t('transfers.transferlerYuklenemediP0', { p0: errorMessage(err) });
      } finally {
        this.loading = false;
      }
    },
    async openCreate() {
      this.form = { destinationBranch: this.destinationOptions[0] || '', lines: [newLine()], notes: '', key: newIdempotencyKey('transfer') };
      this.createDialog = true;
      try {
        const [products, pools] = await Promise.all([apiService.get('/api/products'), apiService.get('/api/inventory/metal')]);
        this.products = products || [];
        this.pools = pools || [];
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('transfers.stokListesiYuklenemediP0', { p0: errorMessage(err) }));
      }
    },
    async create() {
      const lines = this.form.lines.map((l) => {
        if (l.kind === 'product') return { productId: Number(l.productId), quantity: Number(l.quantity) };
        const [metal, purity] = l.pool.split('|');
        return { metal, purity: (Number(purity) / 10000).toFixed(4), weightGrams: normalizeDecimalInput(l.weightGrams) };
      });
      this.saving = true;
      try {
        const created = await apiService.post('/api/transfers', { destinationBranch: this.form.destinationBranch, lines, notes: this.form.notes || undefined }, { headers: { 'Idempotency-Key': this.form.key } });
        this.createDialog = false;
        this.$store.dispatch('notifications/showSuccess', t('transfers.transferP0TaslagiOlusturulduOnay', { p0: created._id }));
        await this.load();
      } catch (err) {
        this.$store.dispatch('notifications/showError', t('transfers.transferOlusturulamadiP0', { p0: errorMessage(err) }));
      } finally {
        this.saving = false;
      }
    },
    async openDetail(t) {
      this.amounts = {};
      this.reason = '';
      this.resolution = 'return_to_source';
      this.commandKey = newIdempotencyKey('trx');
      try {
        this.detail = await apiService.get(`/api/transfers/${t._id}`);
        this.detailDialog = true;
      } catch (err) {
        this.$store.dispatch('notifications/showError', errorMessage(err));
      }
    },
    resolveShortfall() {
      const lines = buildReceiptLines(this.detail.lines, this.amounts);
      return this.act('resolve', { resolution: this.resolution, reason: this.reason, ...(lines.length ? { lines } : {}) }, true);
    },
    async act(action, body, idempotent = false) {
      this.saving = true;
      try {
        const config = idempotent ? { headers: { 'Idempotency-Key': this.commandKey } } : undefined;
        this.detail = await apiService.post(`/api/transfers/${this.detail._id}/${action}`, body, config);
        this.detail = await apiService.get(`/api/transfers/${this.detail._id}`);
        this.amounts = {};
        this.reason = '';
        this.commandKey = newIdempotencyKey('trx');
        this.$store.dispatch('notifications/showSuccess', t('transfers.transferGuncellendiP0', { p0: this.statusLabel(this.detail.status) }));
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
.header-actions { display: flex; align-items: center; gap: 8px; }
.ops-tabs { display: flex; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
.ops-tab { font-size: 12px; padding: 5px 12px; border-radius: var(--jp-radius-sm); border: 1px solid var(--jp-border); background: var(--jp-surface); color: var(--jp-text-muted); cursor: pointer; }
.ops-tab.active { color: var(--jp-gold); border-color: var(--jp-gold-border); background: var(--jp-gold-subtle); }
.tab-count { font-size: 10px; opacity: 0.75; margin-left: 4px; }
.ops-card { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; padding: 8px 12px; }
.ops-error { color: var(--jp-danger); font-size: 12px; padding: 4px 0; }
.ops-hint { font-size: 12px; color: var(--jp-text-subtle); padding: 6px 0; }
.table-scroll-wrap { flex: 1; min-height: 0; overflow: auto; }
.empty-table-state { text-align: center; padding: 24px 0 !important; color: var(--jp-text-subtle); font-size: 12px; }
.clickable { cursor: pointer; }
.text-warning { color: var(--jp-warning); }
.dialog-header { display: flex; align-items: center; font-size: 14px; font-weight: 700; padding-bottom: 6px; border-bottom: 1px solid var(--jp-border); }
.dialog-actions { border-top: 1px solid var(--jp-border); padding-top: 8px; flex-wrap: wrap; gap: 6px; }
.form-label { font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--jp-text-subtle); margin-bottom: 4px; display: block; }
.form-select-full, .form-input-full { width: 100%; height: 32px; padding: 0 8px; font-size: 12px; border: 1px solid var(--jp-border); border-radius: var(--jp-radius-sm); background: var(--jp-surface); color: var(--jp-text); outline: none; }
.form-select-full:focus, .form-input-full:focus { border-color: var(--jp-gold); }
.form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.line-box { border: 1px solid var(--jp-border); border-radius: var(--jp-radius-sm); padding: 8px; background: var(--jp-surface-muted); }
.line-row { display: grid; grid-template-columns: 150px 1fr 110px 28px; gap: 6px; align-items: center; margin-bottom: 6px; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.detail-box { background: var(--jp-surface-muted); border: 1px solid var(--jp-border); border-radius: var(--jp-radius-sm); padding: 8px; font-size: 12px; }
.event-list { list-style: none; padding: 0; margin: 6px 0 0; max-height: 160px; overflow: auto; font-size: 12px; }
.event-list li { padding: 2px 0; border-bottom: 1px dashed var(--jp-border); }
@media (max-width: 900px) {
  .form-grid-2, .detail-grid { grid-template-columns: 1fr; }
  .line-row { grid-template-columns: 1fr 1fr; }
}
</style>
