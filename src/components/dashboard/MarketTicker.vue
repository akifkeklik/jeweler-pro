<template>
  <div class="market-ticker-card">
    <div class="ticker-left" role="link" tabindex="0" @click="open" @keydown.enter="open">
      <span class="live-dot"></span>
      <span class="ticker-title">{{ $t('dashboard.ticker') }}</span>
    </div>
    <div class="ticker-scroll" tabindex="0" role="region" :aria-label="$t('dashboard.ticker')">
      <div
        v-for="quote in displayQuotes"
        :key="quote.symbol"
        class="ticker-item"
        @click="open"
      >
        <span class="quote-name">{{ $instrument(quote.symbol, quote.type) }}</span>
        <span class="quote-val alis" :title="$t('market.buyLabel')">{{ $t('market.buyShort') }}: {{ quote.buyFormatted }}</span>
        <span class="quote-val satis" :title="$t('market.sellLabel')">{{ $t('market.sellShort') }}: {{ quote.sellFormatted }}</span>
        <span class="jp-badge" :class="quote.status === 'live' ? 'jp-badge-success' : 'jp-badge-warning'">
          {{ quote.status === 'live' ? $t('market.live') : $t('market.cached') }}
        </span>
      </div>
      <span v-if="!displayQuotes.length" class="text-caption text-disabled">
        {{ error || $t('dashboard.waitingMarket') }}
      </span>
    </div>
    <v-btn
      variant="text"
      size="x-small"
      class="ticker-link"
      @click="open"
    >
      {{ $t('dashboard.allRates') }} <v-icon size="12" end class="flip-rtl">mdi-chevron-right</v-icon>
    </v-btn>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import marketPriceService, { type MarketQuote } from '@/services/marketPriceService';
import { createAutoRefresh } from '@/services/autoRefresh';
import type { SettingsState } from '@/services/settings';
import { money, t } from '@/i18n';

type TickerQuote = MarketQuote & { status: 'live' | 'stale' };
type AutoRefresh = ReturnType<typeof createAutoRefresh>;

/**
 * Live market strip: the first four preferred quotes. Refreshes on the
 * interval chosen in Settings → Market (0 = manual only); `load()` lets the
 * dashboard refresh it together with the rest of the page.
 */
export default defineComponent({
  name: 'MarketTicker',
  data: () => ({ quotes: [] as TickerQuote[], error: '', autoRefresh: null as AutoRefresh | null }),
  computed: {
    refreshSeconds(): number {
      return (this.$store.state as { settings: SettingsState }).settings.marketAutoRefresh;
    },
    displayQuotes() {
      return this.quotes.slice(0, 4).map((q) => ({
        ...q,
        buyFormatted: money(Number(q.buy) || 0),
        sellFormatted: money(Number(q.sell) || 0),
      }));
    },
  },
  watch: {
    refreshSeconds(seconds: number) {
      this.autoRefresh?.setInterval(seconds);
    },
  },
  mounted() {
    this.autoRefresh = createAutoRefresh(() => this.load(true));
    this.autoRefresh.setInterval(this.refreshSeconds);
  },
  beforeUnmount() {
    this.autoRefresh?.stop();
  },
  methods: {
    open() {
      this.$router.push('/prices');
    },
    async load(force = false) {
      this.error = '';
      try {
        const state = await marketPriceService.loadPrices(force);
        this.quotes = (state.preferredQuotes || []).map((q) => ({ ...q, status: q.isStale ? 'stale' : 'live' }));
        if (!this.quotes.length && state.error) this.error = state.error;
      } catch {
        this.quotes = [];
        this.error = t('dashboard.marketOffline');
      }
    },
  },
});
</script>

<style scoped>
/* Live Market Ticker */
.market-ticker-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background: var(--jp-surface-card);
  border: 1px solid var(--jp-border);
  border-radius: var(--jp-radius-md);
  flex-shrink: 0;
  min-height: 38px;
}

.ticker-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.ticker-title {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.8px;
  color: var(--jp-gold);
}

.ticker-scroll {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
  overflow-x: auto;
  white-space: nowrap;
}

.ticker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--jp-radius-sm);
  background: var(--jp-border-soft);
  transition: background var(--jp-motion-fast) var(--jp-ease-standard);
}
.ticker-item:hover {
  background: var(--jp-border-soft);
}

.quote-name {
  font-weight: 700;
  color: var(--jp-text-emphasis);
}

.quote-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
}
.quote-val.alis {
  color: var(--jp-text-muted);
}
.quote-val.satis {
  color: var(--jp-success);
}

.ticker-link {
  color: var(--jp-gold) !important;
  font-size: 10px !important;
  font-weight: 700 !important;
  text-transform: none !important;
  flex-shrink: 0;
}
</style>
