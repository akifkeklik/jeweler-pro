<template>
  <div class="jp-page-shell prices-page-shell">
    <!-- Header -->
    <div class="jp-page-header">
      <div class="page-heading-left">
        <div>
          <div class="jp-section-label">{{ $t('market.eyebrow') }}</div>
          <h1 class="page-title">
            <v-icon size="20" color="primary">mdi-chart-line</v-icon>
            {{ $t('market.title') }}
          </h1>
        </div>
      </div>
      <div class="header-actions">
        <span v-if="timestamp" class="refresh-meta d-none d-sm-inline">
          <span :class="isStale ? 'stale-dot mr-1' : 'live-dot mr-1'"></span>
          <span>{{ isStale ? $t('market.staleData') : $t('market.liveMarket') }} • {{ $t('common.lastUpdated', { time: formatTime(timestamp) }) }}</span>
        </span>
        <v-btn
          size="small"
          class="jp-secondary"
          :loading="loading"
          @click="fetchPrices"
        >
          <v-icon start size="14">mdi-refresh</v-icon>
          {{ $t('market.refresh') }}
        </v-btn>
      </div>
    </div>

    <!-- Error Alert if any -->
    <v-alert
      v-if="error"
      density="compact"
      type="error"
      variant="tonal"
      class="mb-2 py-1 text-caption"
      closable
      @click:close="error = ''"
    >
      {{ error }}
    </v-alert>

    <!-- Top Benchmarks Ribbon -->
    <div class="benchmark-grid">
      <div v-for="bench in topBenchmarks" :key="bench.key" class="jp-stat-card">
        <div class="jp-stat-icon-wrap" :class="`tone-${bench.tone}`">
          <v-icon size="18">{{ bench.icon }}</v-icon>
        </div>
        <div class="jp-stat-content">
          <span class="jp-stat-label">{{ bench.title }}</span>
          <div class="benchmark-rates">
            <span class="rate-box alis" :title="$t('market.buyLabel')">{{ $t('market.buyShort') }}: {{ bench.buy }}</span>
            <span class="rate-box satis" :title="$t('market.sellLabel')">{{ $t('market.sellShort') }}: {{ bench.sell }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Split Trading Terminal (Strict Zero-Scroll Contract) -->
    <div class="terminal-split-grid">
      <!-- Left: Precious Metals & Market Quotes Table -->
      <div class="terminal-col-left jp-card">
        <div class="terminal-panel-header">
          <div class="panel-title-wrap">
            <v-icon size="16" color="primary" class="mr-1">mdi-diamond-stone</v-icon>
            <span class="panel-title">{{ $t('market.quotesTitle') }}</span>
          </div>
          <div class="d-flex align-center gap-2">
            <span class="jp-badge" :class="marketQuotes.length ? 'jp-badge-success' : 'jp-badge-warning'">
              {{ marketQuotes.length ? $t('market.instruments', { count: $n(marketQuotes.length) }) : $t('market.noData') }}
            </span>
          </div>
        </div>

        <div class="table-scroll-wrap">
          <table class="jp-enterprise-table">
            <thead>
              <tr>
                <th>{{ $t('market.colInstrument') }}</th>
                <th>{{ $t('market.colSource') }}</th>
                <th class="text-right">{{ $t('market.colBid') }}</th>
                <th class="text-right">{{ $t('market.colAsk') }}</th>
                <th class="text-right">{{ $t('market.colSpread') }}</th>
                <th class="text-center" style="width: 100px;">{{ $t('common.status') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="quote in marketQuotes" :key="quote.symbol">
                <td class="font-weight-bold text-white" :title="quote.symbol">
                  {{ $instrument(quote.symbol, quote.type) }}
                </td>
                <td class="text-disabled text-caption">
                  {{ quote.source }}
                </td>
                <td class="text-right tabular font-weight-medium">
                  {{ formatMarketPrice(quote.buy, quote.currency) }}
                </td>
                <td class="text-right tabular font-weight-bold text-success">
                  {{ formatMarketPrice(quote.sell, quote.currency) }}
                </td>
                <td class="text-right tabular text-disabled text-caption">
                  {{ formatSpread(quote.buy, quote.sell, quote.currency) }}
                </td>
                <td class="text-center">
                  <span
                    class="jp-badge"
                    :class="quote.isStale ? 'jp-badge-warning' : (quote.priceType === 'live' ? 'jp-badge-success' : 'jp-badge-info')"
                  >
                    {{ quote.isStale ? $t('market.cached') : (quote.priceType === 'live' ? $t('market.live') : $t('market.reference')) }}
                  </span>
                </td>
              </tr>
              <tr v-if="!loading && !marketQuotes.length">
                <td colspan="6" class="empty-state-cell">
                  <v-icon size="28" class="mb-1 jp-empty-icon">mdi-chart-line-stacked</v-icon>
                  <div>{{ $t('market.noQuotes') }}</div>
                  <v-btn size="x-small" variant="text" class="mt-1" @click="fetchPrices">{{ $t('common.retry') }}</v-btn>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Right: TCMB Currencies & Indicative Theoretical & Internal Shop Prices -->
      <div class="terminal-col-right">
        <!-- TCMB Currencies Card -->
        <div class="tcmb-panel jp-card">
          <div class="terminal-panel-header">
            <div class="panel-title-wrap">
              <v-icon size="16" color="info" class="mr-1">mdi-currency-usd</v-icon>
              <span class="panel-title">{{ $t('market.tcmbTitle') }}</span>
            </div>
            <span class="text-caption text-disabled tabular">{{ $t('market.rates', { count: $n(currencyPrices.length) }) }}</span>
          </div>

          <div class="table-scroll-wrap-half" tabindex="0" role="region" :aria-label="$t('market.tcmbTitle')">
            <table class="jp-enterprise-table">
              <thead>
                <tr>
                  <th>{{ $t('market.colCurrency') }}</th>
                  <th class="text-right">{{ $t('market.buyLabel') }}</th>
                  <th class="text-right">{{ $t('market.sellLabel') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in currencyPrices" :key="c.tur">
                  <td class="font-weight-bold text-white">
                    <span class="currency-tag" :title="$instrument(`${c.tur}/TRY`, c.tur)">{{ c.tur }}</span>
                  </td>
                  <td class="text-right tabular font-weight-medium">
                    {{ rate(c.alis) }}
                  </td>
                  <td class="text-right tabular font-weight-bold text-success">
                    {{ rate(c.satis) }}
                  </td>
                </tr>
                <tr v-if="!currencyPrices.length">
                  <td colspan="3" class="text-center text-disabled py-3 text-caption">
                    {{ $t('market.tcmbUnavailable') }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Indicative Spot Theoretical References -->
        <div v-if="indicativeQuotes.length" class="shop-prices-panel jp-card">
          <div class="terminal-panel-header">
            <div class="panel-title-wrap">
              <v-icon size="16" color="secondary" class="mr-1">mdi-calculator</v-icon>
              <span class="panel-title">{{ $t('market.theoreticalTitle') }}</span>
            </div>
            <span class="text-caption text-disabled">{{ $t('market.theoreticalHint') }}</span>
          </div>

          <div class="table-scroll-wrap-half" tabindex="0" role="region" :aria-label="$t('market.theoreticalTitle')">
            <table class="jp-enterprise-table">
              <thead>
                <tr>
                  <th>{{ $t('market.colReference') }}</th>
                  <th class="text-right">{{ $t('market.colTheoretical') }}</th>
                  <th>{{ $t('market.colFormula') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="ind in indicativeQuotes.slice(0, 5)" :key="ind.symbol">
                  <td class="font-weight-medium text-white">{{ $instrument(ind.symbol, ind.type) }}</td>
                  <td class="text-right tabular font-weight-bold text-warning">{{ money(ind.last) }}</td>
                  <td class="text-caption text-disabled text-truncate" style="max-width: 140px;" :title="ind.formula">{{ formulaText(ind.formula) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Registered Enterprise Shop Prices -->
        <div class="shop-prices-panel jp-card">
          <div class="terminal-panel-header">
            <div class="panel-title-wrap">
              <v-icon size="16" color="success" class="mr-1">mdi-storefront-outline</v-icon>
              <span class="panel-title">{{ $t('market.shopTitle') }}</span>
            </div>
            <span class="text-caption text-disabled tabular">{{ $t('market.shopCount', { count: $n(databasePrices.length) }) }}</span>
          </div>

          <div class="table-scroll-wrap-half" tabindex="0" role="region" :aria-label="$t('market.shopTitle')">
            <table class="jp-enterprise-table">
              <thead>
                <tr>
                  <th>{{ $t('market.colGoldType') }}</th>
                  <th class="text-right">{{ $t('market.colShopBuy') }}</th>
                  <th class="text-right">{{ $t('market.colShopSell') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in databasePrices" :key="p._id || p.type || p.tur">
                  <td class="font-weight-medium text-white">{{ p.type || p.tur }}</td>
                  <td class="text-right tabular">{{ money(p.buy) }}</td>
                  <td class="text-right tabular font-weight-bold text-success">{{ money(p.sell) }}</td>
                </tr>
                <tr v-if="!databasePrices.length">
                  <td colspan="3" class="text-center text-disabled py-3 text-caption">
                    {{ $t('market.noShopPrices') }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Provider Status & System Integrity Strip -->
        <div class="provider-status-strip jp-card">
          <div class="provider-info-item" v-for="p in providers" :key="p.id">
            <span class="status-indicator-dot" :class="p.status === 'ok' ? 'ok' : (p.status === 'stale' ? 'warn' : 'err')"></span>
            <span class="provider-name">{{ p.name }}:</span>
            <span class="provider-meta tabular" :title="p.status !== 'ok' && $i18n.language === 'tr' ? p.error : undefined">{{ p.status === 'ok' ? $t('market.providerQuotes', { count: $n(p.quoteCount) }) : providerStatus(p.status) }}</span>
          </div>
          <div class="integrity-badge">
            <v-icon size="12" color="success" class="mr-1">mdi-shield-check</v-icon>
            {{ $t('market.verified') }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import marketPriceService from '@/services/marketPriceService';
import { createAutoRefresh } from '@/services/autoRefresh';
import { instrumentLabel, money, t, time, tOptional } from '@/i18n';

export default {
  name: 'PricesPage',
  data() {
    return {
      currencyPrices: [],
      databasePrices: [],
      marketQuotes: [],
      indicativeQuotes: [],
      providers: [],
      timestamp: null,
      isStale: false,
      loading: false,
      error: '',
      unsubscribe: null,
    };
  },
  computed: {
    topBenchmarks() {
      const getQuote = (sym) => this.marketQuotes.find((q) => q.symbol && q.symbol.toUpperCase().includes(sym));
      const getCurr = (cur) => this.currencyPrices.find((c) => c.tur && c.tur.toUpperCase().includes(cur));

      const hasGold =
        this.marketQuotes.find((q) => q.symbol === 'HAS_ALTIN' || q.symbol === 'GRAM_ALTIN' || q.symbol === 'GA') ||
        this.marketQuotes.find((q) => q.symbol && q.symbol.startsWith('HAS'));
      const usd = getCurr('USD') || getQuote('USD/TRY') || getQuote('USD');
      const eur = getCurr('EUR') || getQuote('EUR/TRY') || getQuote('EUR');
      const ceyrek =
        this.marketQuotes.find((q) => q.symbol === 'CEYREK_ALTIN') ||
        getQuote('CEYREK');

      return [
        {
          key: 'gold',
          title: hasGold ? instrumentLabel(hasGold.symbol, hasGold.type) : instrumentLabel('HAS_ALTIN'),
          buy: hasGold ? this.formatMarketPrice(hasGold.buy, hasGold.currency || 'TRY') : '—',
          sell: hasGold ? this.formatMarketPrice(hasGold.sell, hasGold.currency || 'TRY') : '—',
          icon: 'mdi-diamond-stone',
          tone: 'primary',
        },
        {
          key: 'quarter',
          title: ceyrek ? instrumentLabel(ceyrek.symbol, ceyrek.type) : instrumentLabel('CEYREK_ALTIN'),
          buy: ceyrek ? this.formatMarketPrice(ceyrek.buy, ceyrek.currency || 'TRY') : '—',
          sell: ceyrek ? this.formatMarketPrice(ceyrek.sell, ceyrek.currency || 'TRY') : '—',
          icon: 'mdi-circle-multiple-outline',
          tone: 'warning',
        },
        {
          key: 'usd',
          title: 'USD / TRY',
          buy: usd ? (usd.alis ? this.rate(usd.alis) : this.formatMarketPrice(usd.buy, 'TRY')) : '—',
          sell: usd ? (usd.satis ? this.rate(usd.satis) : this.formatMarketPrice(usd.sell, 'TRY')) : '—',
          icon: 'mdi-currency-usd',
          tone: 'info',
        },
        {
          key: 'eur',
          title: 'EUR / TRY',
          buy: eur ? (eur.alis ? this.rate(eur.alis) : this.formatMarketPrice(eur.buy, 'TRY')) : '—',
          sell: eur ? (eur.satis ? this.rate(eur.satis) : this.formatMarketPrice(eur.sell, 'TRY')) : '—',
          icon: 'mdi-currency-eur',
          tone: 'success',
        },
      ];
    },
  },
  watch: {
    // Settings → Market → auto-refresh interval (seconds; 0 = manual only).
    '$store.state.settings.marketAutoRefresh'(seconds) {
      if (this.autoRefresh) this.autoRefresh.setInterval(seconds);
    },
  },
  mounted() {
    this.unsubscribe = marketPriceService.subscribe((state) => {
      this.handleMarketState(state);
    });
    this.fetchPrices();
    // Background ticks are quiet: the subscription updates the table, no spinner.
    this.autoRefresh = createAutoRefresh(() => marketPriceService.loadPrices(true));
    this.autoRefresh.setInterval(this.$store.state.settings.marketAutoRefresh);
  },
  beforeUnmount() {
    if (this.autoRefresh) this.autoRefresh.stop();
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  },
  methods: {
    handleMarketState(state) {
      this.currencyPrices = (state.currencies || []).map((item) => ({
        tur: item.currency,
        alis: item.buyPrice,
        satis: item.sellPrice,
      }));
      this.databasePrices = state.databasePrices || [];
      this.marketQuotes = state.preferredQuotes || [];
      this.indicativeQuotes = state.indicativeQuotes || [];
      this.providers = state.providers || [];
      this.timestamp = state.timestamp;
      this.isStale = state.isStale;
      this.error = state.error || '';
    },
    async fetchPrices() {
      this.loading = true;
      this.error = '';
      try {
        await marketPriceService.loadPrices(true);
      } catch (err) {
        this.error = err.message || t('market.loadFailed');
      } finally {
        this.loading = false;
      }
    },
    // A missing quote renders as "—" (via the shared formatter), never as a
    // fabricated ₺0,00 price.
    money(value) {
      return money(value);
    },
    formatMarketPrice(value, currency) {
      return money(value, currency || 'TRY');
    },
    /** TCMB rates arrive as text ("38.4500", optionally with ▲/▼); 4 decimals, in TRY. */
    rate(value) {
      const num = Number(this.cleanValue(value).replace(',', '.'));
      if (!Number.isFinite(num)) return this.cleanValue(value) || '—';
      return money(num, 'TRY', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    },
    /** Backend formulas embed Turkish words; keep the maths, localize the words. */
    formulaText(formula) {
      if (!formula) return '—';
      return String(formula)
        .replace(/\s*\(İşçilik ve basım primi hariç\)/, ` (${t('market.formulaExclLabour')})`)
        .replace(/\bHas Spot\b/g, t('market.formulaSpot'));
    },
    providerStatus(status) {
      return tOptional(`market.providerStatus.${status}`, status || '—');
    },
    formatSpread(buy, sell, currency) {
      const diff = Math.abs((Number(sell) || 0) - (Number(buy) || 0));
      return this.formatMarketPrice(diff, currency);
    },
    formatTime(value) {
      return value ? time(value, true) : '—';
    },
    cleanValue(value) {
      return String(value ?? '')
        .replace('▲', '')
        .replace('▼', '')
        .trim();
    },
  },
};
</script>

<style scoped>
.prices-page-shell {
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
  gap: 10px;
}

.refresh-meta {
  font-size: 11px;
  color: var(--jp-text-muted);
  display: flex;
  align-items: center;
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: var(--jp-success);
  display: inline-block;
  box-shadow: 0 0 6px var(--jp-success-border);
}

.stale-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: var(--jp-warning);
  display: inline-block;
}

/* Benchmarks Ribbon */
.benchmark-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  flex-shrink: 0;
}

.benchmark-rates {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}

.rate-box {
  font-size: 11px;
  font-family: monospace;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
}

.rate-box.alis {
  background: var(--jp-border-soft);
  color: var(--jp-ink-300);
}

.rate-box.satis {
  background: var(--jp-success-bg);
  color: var(--jp-success);
}

/* Split Terminal Grid */
.terminal-split-grid {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.terminal-col-left {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 8px 12px;
}

.terminal-col-right {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
}

.terminal-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--jp-border);
  flex-shrink: 0;
}

.panel-title-wrap {
  display: flex;
  align-items: center;
}

.panel-title {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: var(--jp-text-emphasis);
}

.table-scroll-wrap {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.table-scroll-wrap-half {
  max-height: 140px;
  overflow-y: auto;
}

.empty-state-cell {
  text-align: center;
  padding: 24px 0 !important;
  color: var(--jp-text-muted);
  font-size: 12px;
}

.currency-tag {
  background: var(--jp-info-bg);
  color: var(--jp-info);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.provider-status-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.2);
}

.provider-info-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-indicator-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-indicator-dot.ok {
  background-color: var(--jp-success);
}

.status-indicator-dot.warn {
  background-color: var(--jp-warning);
}

.status-indicator-dot.err {
  background-color: var(--jp-danger);
}

.provider-name {
  color: var(--jp-text-muted);
  font-weight: 600;
}

.provider-meta {
  color: var(--jp-text);
}

.integrity-badge {
  margin-left: auto;
  display: flex;
  align-items: center;
  font-size: 10px;
  color: var(--jp-success);
  font-weight: 600;
}
</style>
