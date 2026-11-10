const axios = require('axios');
const MarketDataProvider = require('./marketDataProvider');

const GOLD_SYMBOL_MAP = {
  GA: { symbol: 'HAS_ALTIN', type: 'Has Altın (24K)', asset: 'gold' },
  '22': { symbol: '22_AYAR', type: '22 Ayar Bilezik', asset: 'gold' },
  '18': { symbol: '18_AYAR', type: '18 Ayar Altın', asset: 'gold' },
  '14': { symbol: '14_AYAR', type: '14 Ayar Altın', asset: 'gold' },
  C: { symbol: 'CEYREK_ALTIN', type: 'Çeyrek Altın', asset: 'gold' },
  Y: { symbol: 'YARIM_ALTIN', type: 'Yarım Altın', asset: 'gold' },
  T: { symbol: 'TAM_ALTIN', type: 'Tam Altın (Ziynet)', asset: 'gold' },
  CMR: { symbol: 'CUMHURIYET_ALTIN', type: 'Cumhuriyet Altını', asset: 'gold' },
  ATA: { symbol: 'ATA_LIRA', type: 'Ata Lira (Cumhuriyet)', asset: 'gold' },
  GR: { symbol: 'GREMSE_ALTIN', type: 'Gremse Altın', asset: 'gold' },
  RA: { symbol: 'RESAT_ALTIN', type: 'Reşat Altın', asset: 'gold' },
  HA: { symbol: 'HAMIT_ALTIN', type: 'Hamit Altın', asset: 'gold' },
  IKB: { symbol: 'IKI_BUCUK_ALTIN', type: 'İki Buçuk Altın', asset: 'gold' },
  BSL: { symbol: 'BESLI_ALTIN', type: 'Beşli Altın', asset: 'gold' },
  GAG: { symbol: 'GUMUS_GRAM', type: 'Gümüş (Gram)', asset: 'silver' },
  XAUUSD: { symbol: 'ONS_USD', type: 'Ons Altın (USD)', asset: 'gold', defaultCurrency: 'USD' },
};

const DOVIZ_SYMBOL_MAP = {
  USD: { symbol: 'USD/TRY', type: 'Amerikan Doları (Serbest Piyasa)', asset: 'currency' },
  EUR: { symbol: 'EUR/TRY', type: 'Euro (Serbest Piyasa)', asset: 'currency' },
  GBP: { symbol: 'GBP/TRY', type: 'İngiliz Sterlini (Serbest Piyasa)', asset: 'currency' },
  CHF: { symbol: 'CHF/TRY', type: 'İsviçre Frangı (Serbest Piyasa)', asset: 'currency' },
  CAD: { symbol: 'CAD/TRY', type: 'Kanada Doları (Serbest Piyasa)', asset: 'currency' },
  AUD: { symbol: 'AUD/TRY', type: 'Avustralya Doları (Serbest Piyasa)', asset: 'currency' },
};

class GenelparaProvider extends MarketDataProvider {
  constructor() {
    super({
      id: 'genelpara',
      name: 'GenelPara Piyasa Verileri',
      termsUrl: 'https://www.genelpara.com/',
      configured: process.env.GENELPARA_ENABLED !== 'false',
      priority: 10,
      maxAgeMs: 5 * 60 * 1000, // 5 minutes
      requiresAuth: false,
      // The free API allows ~1000 requests/day and every refresh costs 2;
      // 3 minutes ⇒ ≤ 960 requests/day. Quotes stay "live" for 5 minutes.
      minFetchIntervalMs: Number(process.env.GENELPARA_MIN_INTERVAL_MS) || 3 * 60 * 1000,
      timestampSource: 'received',
    });
  }

  /** The API reports its remaining daily request quota; surface it in status. */
  recordQuota(remaining) {
    const value = Number(remaining);
    if (!Number.isFinite(value)) return;
    this.quotaRemaining = value;
    if (value < 100 && !this.quotaWarned) {
      this.quotaWarned = true;
      console.warn(`[market-data] GenelPara günlük istek kotası azaldı (kalan: ${value}); fiyatlar yakında bayatlayabilir.`);
    }
    if (value >= 100) this.quotaWarned = false;
  }

  async fetchQuotes() {
    if (!this.configured) return [];

    const quotes = [];
    const nowIso = new Date().toISOString();

    // 1. Fetch Gold/Metals
    try {
      const resAltin = await axios.get('https://api.genelpara.com/json/?list=altin', {
        timeout: 5000,
        headers: {
          'User-Agent': 'JewelerPro/1.0 (+https://jewelerpro.local)',
          Accept: 'application/json',
        },
      });

      this.recordQuota(resAltin.data?.remaining);
      if (resAltin.data?.success && resAltin.data?.data) {
        const data = resAltin.data.data;
        for (const [key, meta] of Object.entries(GOLD_SYMBOL_MAP)) {
          const item = data[key];
          if (!item) continue;
          const buy = Number.parseFloat(String(item.alis).replace(',', '.'));
          const sell = Number.parseFloat(String(item.satis).replace(',', '.'));
          const changeRate = Number.parseFloat(String(item.oran || '0').replace(',', '.'));

          if (Number.isFinite(buy) && Number.isFinite(sell) && buy > 0 && sell > 0 && sell >= buy) {
            const currency = item.kur || meta.defaultCurrency || 'TRY';
            const precision = currency === 'TRY' ? 2 : 4;
            quotes.push({
              symbol: meta.symbol,
              type: meta.type,
              asset: meta.asset,
              buy: Number(buy.toFixed(precision)),
              sell: Number(sell.toFixed(precision)),
              last: Number(((buy + sell) / 2).toFixed(precision)),
              spread: Number(Math.abs(sell - buy).toFixed(precision)),
              changeRate: Number.isFinite(changeRate) ? changeRate : 0,
              currency,
              source: this.id,
              priceType: 'live',
              sourceTimestamp: nowIso,
              updatedAt: nowIso,
            });
          }
        }
      }
    } catch (err) {
      // Gold fetch failure logged by caller or handled gracefully
    }

    // 2. Fetch Free Market Currencies (USD, EUR, GBP)
    try {
      const resDoviz = await axios.get('https://api.genelpara.com/json/?list=doviz', {
        timeout: 5000,
        headers: {
          'User-Agent': 'JewelerPro/1.0 (+https://jewelerpro.local)',
          Accept: 'application/json',
        },
      });

      this.recordQuota(resDoviz.data?.remaining);
      if (resDoviz.data?.success && resDoviz.data?.data) {
        const data = resDoviz.data.data;
        for (const [key, meta] of Object.entries(DOVIZ_SYMBOL_MAP)) {
          const item = data[key];
          if (!item) continue;
          const buy = Number.parseFloat(String(item.alis).replace(',', '.'));
          const sell = Number.parseFloat(String(item.satis).replace(',', '.'));
          const changeRate = Number.parseFloat(String(item.oran || '0').replace(',', '.'));

          if (Number.isFinite(buy) && Number.isFinite(sell) && buy > 0 && sell > 0 && sell >= buy) {
            quotes.push({
              symbol: meta.symbol,
              type: meta.type,
              asset: meta.asset,
              buy: Number(buy.toFixed(4)),
              sell: Number(sell.toFixed(4)),
              last: Number(((buy + sell) / 2).toFixed(4)),
              spread: Number(Math.abs(sell - buy).toFixed(4)),
              changeRate: Number.isFinite(changeRate) ? changeRate : 0,
              currency: 'TRY',
              source: this.id,
              priceType: 'live',
              sourceTimestamp: nowIso,
              updatedAt: nowIso,
            });
          }
        }
      }
    } catch (err) {
      // Doviz fetch failure handled gracefully
    }

    return quotes;
  }
}

module.exports = GenelparaProvider;

