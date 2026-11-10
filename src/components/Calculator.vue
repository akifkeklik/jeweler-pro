<template>
  <div class="jp-page-shell calculator-page-shell">
    <!-- Header -->
    <div class="jp-page-header">
      <div class="page-heading-left">
        <div>
          <div class="jp-section-label">{{ $t('calculator.hesapVeMilyemDonusumMerkezi') }}</div>
          <h1 class="page-title">
            <v-icon size="20" color="primary">mdi-calculator-variant</v-icon>
            {{ $t('calculator.kuyumculukHasAltinHesapMakinesi') }}
          </h1>
        </div>
      </div>
      <div class="header-actions">
        <!-- Live or Stale Status Meta -->
        <span v-if="liveHasPrice" class="refresh-meta d-none d-sm-inline">
          <span :class="isPriceStale ? 'stale-dot mr-1' : 'live-dot mr-1'"></span>
          <span>{{ isPriceStale ? $t('calculator.onbellekHasFiyati') : $t('calculator.canliHasFiyati') }}</span>
          <strong class="tabular ml-1" :class="isPriceStale ? 'text-warning' : 'text-success'">
            {{ $t('calculator.p0Gr', { p0: money(liveHasPrice) }) }}
          </strong>
          <span class="source-tag ml-1">({{ priceSource }} • {{ formatTime(lastUpdated) }})</span>
        </span>
        <span v-else class="refresh-meta d-none d-sm-inline text-disabled">
          <v-icon size="12" class="mr-1">mdi-alert-circle-outline</v-icon>
          {{ $t('calculator.piyasaFiyatiBekleniyor') }}
        </span>

        <v-btn
          size="small"
          class="jp-secondary"
          :loading="loadingPrice"
          @click="refreshPrices"
        >
          <v-icon start size="14">mdi-refresh</v-icon>
          {{ $t('calculator.fiyatiGuncelle') }}
        </v-btn>
      </div>
    </div>

    <!-- Error notice if fetch failed -->
    <v-alert
      v-if="priceError"
      density="compact"
      type="warning"
      variant="tonal"
      class="mb-2 py-1 text-caption"
      closable
      @click:close="priceError = ''"
    >
      {{ $t('calculator.p0ManuelOlarakGramFiyati', { p0: priceError }) }}
    </v-alert>

    <!-- Main Calculator Cockpit: 2 Columns -->
    <div class="calculator-split-grid">
      <!-- Left: Interactive Calculation Card -->
      <div class="calculator-main-card jp-card">
        <div class="calc-card-header">
          <v-icon size="16" color="primary" class="mr-1">mdi-scale-balance</v-icon>
          <span class="calc-header-title">{{ $t('calculator.hizliAltinVeAyarHesabi') }}</span>
        </div>

        <div class="calc-body">
          <!-- Inputs Row -->
          <div class="inputs-row">
            <div class="input-col">
              <label class="form-label" for="calculator-f1">{{ $t('calculator.hesaplanacakMiktarAdet') }}</label>
              <div class="amount-control-wrap">
                <input id="calculator-f1"
                  v-model.number="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  class="calc-input-full tabular"
                />
                <div class="quick-increment-buttons">
                  <button type="button" @click="amount += 1">+1</button>
                  <button type="button" @click="amount += 5">+5</button>
                  <button type="button" @click="amount += 10">+10</button>
                  <button type="button" @click="amount = 1">1</button>
                </div>
              </div>
            </div>

            <div class="input-col">
              <label class="form-label" for="calculator-f2">{{ $t('calculator.altinBirimTuru') }}</label>
              <select id="calculator-f2" v-model="selectedUnitValue" class="calc-select-full">
                <option v-for="u in units" :key="u.value" :value="u.value">
                  {{ $t('calculator.p0P1GrP2', { p0: u.text, p1: $weight(u.gram, 3), p2: $n(u.milyem * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) }}
                </option>
              </select>
            </div>
          </div>

          <!-- Gram Price Customizer -->
          <div class="gram-price-row mt-3">
            <div class="price-input-col">
              <div class="d-flex justify-space-between align-center">
                <label class="form-label" for="calculator-f3">{{ $t('calculator.hasGramAlisSatisBaz') }}</label>
                <span v-if="isPriceStale" class="text-caption text-warning tabular">
                  {{ $t('calculator.onbellekVeri') }}
                </span>
              </div>
              <div class="price-input-wrap">
                <input id="calculator-f3"
                  v-model.number="pricePerGram"
                  type="number"
                  step="1"
                  :placeholder="$t('calculator.bazGramFiyatiGirinizOrn')"
                  class="calc-input-full tabular"
                />
                <button
                  v-if="liveHasPrice && pricePerGram !== liveHasPrice"
                  type="button"
                  class="sync-btn"
                  @click="pricePerGram = liveHasPrice"
                >
                  {{ $t('calculator.canliyaEsitleP0', { p0: money(liveHasPrice) }) }}
                </button>
              </div>
            </div>
          </div>

          <!-- Big Result Box -->
          <div class="calculator-result-box mt-4">
            <div class="result-eyebrow">{{ $t('calculator.hesaplananDegerVeKarsilik') }}</div>
            <div class="result-main-value tabular" :class="{ 'text-disabled': !hasValidPrice }">
              {{ hasValidPrice ? money(totalCalculatedPrice) : '— ₺' }}
            </div>
            <div v-if="hasValidPrice" class="result-details-row">
              <span>{{ $t('calculator.toplamAgirlik') }} <strong class="tabular">{{ $weight(totalGrams, 2) }}</strong></span>
              <span class="divider">•</span>
              <span>{{ $t('calculator.hasAltinKarsiligi24k') }} <strong class="tabular text-warning">{{ $weight(totalHasGrams, 3) }}</strong></span>
              <span class="divider">•</span>
              <span>{{ $t('calculator.ayar') }} <strong class="tabular">{{ currentUnit.karat || $t('calculator.has') }}</strong></span>
            </div>
            <div v-else class="text-caption text-disabled text-center mt-1">
              {{ $t('calculator.hesaplamaIcinGecerliBirHas') }}
            </div>
          </div>

          <div class="quick-karat-pills mt-3">
            <span class="pills-title">{{ $t('calculator.hizliAyarSecimi') }}</span>
            <div class="pills-wrap">
              <button
                v-for="preset in karatPresets"
                :key="preset.value"
                type="button"
                class="karat-pill"
                :class="{ active: selectedUnitValue === preset.value }"
                @click="selectedUnitValue = preset.value"
              >
                {{ preset.label }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Live Unit Rates Table Card -->
      <div class="calculator-table-card jp-card">
        <div class="calc-card-header">
          <v-icon size="16" color="info" class="mr-1">mdi-format-list-numbered</v-icon>
          <span class="calc-header-title">{{ $t('calculator.birimKarsiliklariTablosu') }}</span>
          <v-spacer></v-spacer>
          <span class="text-caption text-disabled tabular">{{ $t('calculator.n1AdetUzerinden') }}</span>
        </div>

        <div class="table-scroll-wrap">
          <table class="jp-enterprise-table">
            <thead>
              <tr>
                <th>{{ $t('calculator.birimAyar') }}</th>
                <th class="text-right">{{ $t('calculator.agirlik') }}</th>
                <th class="text-right">{{ $t('calculator.milyem') }}</th>
                <th class="text-right">{{ $t('calculator.birimFiyat') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="u in units"
                :key="u.value"
                :class="{ 'selected-calc-row': selectedUnitValue === u.value }"
                @click="selectedUnitValue = u.value"
              >
                <td class="font-weight-medium text-white">
                  {{ u.text }}
                </td>
                <td class="text-right tabular font-weight-bold">
                  {{ $weight(u.gram, 3) }}
                </td>
                <td class="text-right tabular text-disabled">
                  {{ u.milyem }}
                </td>
                <td class="text-right tabular font-weight-bold" :class="hasValidPrice ? 'text-success' : 'text-disabled'">
                  {{ hasValidPrice ? money(u.gram * u.milyem * pricePerGram) : '— ₺' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { money, t, time } from '@/i18n';
import marketPriceService from '@/services/marketPriceService';

export default {
  name: 'Calculator',
  data() {
    return {
      amount: 1,
      selectedUnitValue: 'has',
      // Fixed 3100 TL fallback is COMPLETELY REMOVED.
      // Initialized strictly as null until real live data or manual input arrives.
      pricePerGram: null,
      liveHasPrice: null,
      isPriceStale: false,
      priceSource: '',
      lastUpdated: null,
      loadingPrice: false,
      priceError: '',
      unsubscribe: null,
      units: [
        { get text() { return t('calculator.hasAltin24k'); }, value: 'has', gram: 1, milyem: 1.0, karat: '24K' },
        { get text() { return t('calculator.n22AyarBilezik'); }, value: '22k', gram: 1, milyem: 0.916, karat: '22K' },
        { get text() { return t('calculator.n18AyarAltin'); }, value: '18k', gram: 1, milyem: 0.75, karat: '18K' },
        { get text() { return t('calculator.n14AyarTaki'); }, value: '14k', gram: 1, milyem: 0.585, karat: '14K' },
        { get text() { return t('calculator.ceyrekAltin'); }, value: 'ceyrek', gram: 1.75, milyem: 0.916, karat: '22K' },
        { get text() { return t('calculator.yarimAltin'); }, value: 'yarim', gram: 3.5, milyem: 0.916, karat: '22K' },
        { get text() { return t('calculator.tamAltinZiynet'); }, value: 'tam', gram: 7.0, milyem: 0.916, karat: '22K' },
        { get text() { return t('calculator.ataLiraCumhuriyet'); }, value: 'ata', gram: 7.216, milyem: 0.916, karat: '22K' },
        { get text() { return t('calculator.gremseAltin'); }, value: 'gremse', gram: 17.5, milyem: 0.916, karat: '22K' },
      ],
      karatPresets: [
        { get label() { return t('calculator.has24k'); }, value: 'has' },
        { get label() { return t('calculator.n22Ayar'); }, value: '22k' },
        { get label() { return t('calculator.n18Ayar'); }, value: '18k' },
        { get label() { return t('calculator.n14Ayar'); }, value: '14k' },
        { get label() { return t('calculator.ceyrek'); }, value: 'ceyrek' },
        { get label() { return t('calculator.yarim'); }, value: 'yarim' },
        { get label() { return t('calculator.tam'); }, value: 'tam' },
        { get label() { return t('calculator.ataLira'); }, value: 'ata' },
      ],
    };
  },
  computed: {
    hasValidPrice() {
      return Number.isFinite(this.pricePerGram) && this.pricePerGram > 0;
    },
    currentUnit() {
      return this.units.find((u) => u.value === this.selectedUnitValue) || this.units[0];
    },
    totalGrams() {
      return (Number(this.amount) || 0) * this.currentUnit.gram;
    },
    totalHasGrams() {
      return this.totalGrams * this.currentUnit.milyem;
    },
    totalCalculatedPrice() {
      if (!this.hasValidPrice) return 0;
      return this.totalHasGrams * this.pricePerGram;
    },
  },
  mounted() {
    this.unsubscribe = marketPriceService.subscribe((state) => {
      this.handleMarketState(state);
    });
    this.fetchLivePrice();
  },
  beforeUnmount() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  },
  methods: {
    handleMarketState(state) {
      const hasQuote = marketPriceService.getHasGoldQuote();
      if (hasQuote && hasQuote.sell) {
        const roundedPrice = Math.round(Number(hasQuote.sell));
        this.liveHasPrice = roundedPrice;
        if (this.pricePerGram === null || this.pricePerGram === 0) {
          this.pricePerGram = roundedPrice;
        }
        this.isPriceStale = Boolean(hasQuote.isStale || hasQuote.priceType === 'cached');
        this.priceSource = hasQuote.source || t('calculator.piyasa');
        this.lastUpdated = hasQuote.sourceTimestamp || state.timestamp;
      }
      this.priceError = state.error || '';
    },
    async fetchLivePrice() {
      this.loadingPrice = true;
      try {
        await marketPriceService.loadPrices(false);
      } catch (err) {
        // Handled within marketPriceService
      } finally {
        this.loadingPrice = false;
      }
    },
    async refreshPrices() {
      this.loadingPrice = true;
      try {
        await marketPriceService.loadPrices(true);
      } catch (err) {
        // Handled within marketPriceService
      } finally {
        this.loadingPrice = false;
      }
    },
    money(val) {
      return money(Number(val) || 0);
    },
    formatTime(value) {
      return value ? time(value, true) : '—';
    },
  },
};
</script>

<style scoped>
.calculator-page-shell {
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

.source-tag {
  font-size: 10px;
  color: var(--jp-text-muted);
}

.stale-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: var(--jp-warning);
  display: inline-block;
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: var(--jp-success);
  display: inline-block;
  box-shadow: 0 0 6px var(--jp-success-border);
}

/* Split Cockpit */
.calculator-split-grid {
  display: grid;
  grid-template-columns: 1fr 420px;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.calculator-main-card,
.calculator-table-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 10px 14px;
}

.calc-card-header {
  display: flex;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--jp-border);
  flex-shrink: 0;
}

.calc-header-title {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: var(--jp-text-emphasis);
}

.calc-body {
  flex: 1;
  overflow-y: auto;
  padding-top: 10px;
  display: flex;
  flex-direction: column;
}

.inputs-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.form-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--jp-text-muted);
  display: block;
  margin-bottom: 4px;
}

.amount-control-wrap {
  display: flex;
  gap: 6px;
}

.calc-input-full,
.calc-select-full {
  flex: 1;
  background-color: var(--jp-border-soft);
  border: 1px solid var(--jp-border);
  border-radius: 6px;
  color: var(--jp-text-emphasis);
  padding: 7px 10px;
  font-size: 13px;
  outline: none;
}

.calc-input-full:focus,
.calc-select-full:focus {
  border-color: var(--jp-primary);
}

.quick-increment-buttons {
  display: flex;
  gap: 4px;
}

.quick-increment-buttons button {
  background: var(--jp-border-soft);
  border: 1px solid var(--jp-border);
  border-radius: 4px;
  color: var(--jp-ink-300);
  font-size: 11px;
  padding: 0 8px;
  cursor: pointer;
}

.quick-increment-buttons button:hover {
  background: var(--jp-gold-border);
  color: var(--jp-primary);
}

.price-input-wrap {
  display: flex;
  gap: 8px;
}

.sync-btn {
  background: var(--jp-gold-subtle);
  border: 1px solid var(--jp-primary);
  color: var(--jp-primary);
  border-radius: 6px;
  padding: 0 12px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.sync-btn:hover {
  background: var(--jp-primary);
  color: #000;
}

/* Result Box */
.calculator-result-box {
  background: linear-gradient(135deg, var(--jp-gold-subtle) 0%, var(--jp-surface-muted) 100%);
  border: 1px solid var(--jp-gold-border);
  border-radius: 8px;
  padding: 14px;
  text-align: center;
}

.result-eyebrow {
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--jp-primary);
  font-weight: 700;
  margin-bottom: 4px;
}

.result-main-value {
  font-size: 28px;
  font-weight: 800;
  color: var(--jp-text-emphasis);
}

.result-details-row {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--jp-ink-300);
  margin-top: 8px;
}

.result-details-row .divider {
  color: var(--jp-border-light);
}

.quick-karat-pills {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pills-title {
  font-size: 11px;
  color: var(--jp-text-muted);
}

.pills-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.karat-pill {
  background: var(--jp-border-soft);
  border: 1px solid var(--jp-border);
  color: var(--jp-text-muted);
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
}

.karat-pill.active {
  background: var(--jp-gold-border);
  border-color: var(--jp-primary);
  color: var(--jp-primary);
  font-weight: 700;
}

.table-scroll-wrap {
  flex: 1;
  overflow-y: auto;
  margin-top: 8px;
}

.selected-calc-row {
  background-color: var(--jp-gold-subtle) !important;
}
</style>
