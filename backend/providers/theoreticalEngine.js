/**
 * Theoretical Reference Price Engine.
 *
 * Calculates mathematical spot reference values from international spot gold
 * (XAU/USD - Ounce) and USD/TRY exchange rates.
 *
 * IMPORTANT:
 * As mandated by financial compliance standards, these values are strictly
 * flagged as `indicative` (hesaplanmış referans fiyat) and MUST NOT be presented
 * as real physical jeweler retail/wholesale quotations with fabricated workmanship
 * or synthetic spreads.
 */

const TROY_OUNCE_GRAMS = 31.1034768;

// Standard physical parameters for Turkish mint (Darphane) & jeweler products
const PURITY = Object.freeze({
  HAS_24K: 1.0,
  KARAT_22: 0.916,
  KARAT_18: 0.75,
  KARAT_14: 0.585,
});

const DARPHANE_WEIGHTS = Object.freeze({
  CEYREK: 1.75,   // 22 Ayar (0.916 purity) -> 1.603g fine gold
  YARIM: 3.5,     // 22 Ayar (0.916 purity) -> 3.206g fine gold
  TAM: 7.0,       // 22 Ayar (0.916 purity) -> 6.412g fine gold
  ATA: 7.216,     // 22 Ayar (0.916 purity) -> 6.609856g fine gold
  GREMSE: 17.5,   // 22 Ayar (0.916 purity) -> 16.03g fine gold
});

class TheoreticalEngine {
  /**
   * Derive theoretical indicative prices from spot ounce and USD/TRY exchange rates.
   *
   * @param {Object} params
   * @param {number} params.onsUsd - Spot gold price in USD per troy ounce (e.g. 4065.50)
   * @param {number} params.usdTry - USD/TRY exchange rate (e.g. 50.15)
   * @param {string} [params.timestamp] - Source timestamp
   * @returns {Array<Object>} List of indicative reference quotes
   */
  static calculateIndicativeQuotes({ onsUsd, usdTry, timestamp = new Date().toISOString() }) {
    if (!Number.isFinite(onsUsd) || onsUsd <= 0 || !Number.isFinite(usdTry) || usdTry <= 0) {
      return [];
    }

    // Theoretical Has Gram Spot (24K Pure Gold in TRY)
    const rawHasGram = (onsUsd * usdTry) / TROY_OUNCE_GRAMS;
    const hasGram = Number(rawHasGram.toFixed(2));

    const raw22k = rawHasGram * PURITY.KARAT_22;
    const raw18k = rawHasGram * PURITY.KARAT_18;
    const raw14k = rawHasGram * PURITY.KARAT_14;

    const rawCeyrek = rawHasGram * DARPHANE_WEIGHTS.CEYREK * PURITY.KARAT_22;
    const rawYarim = rawHasGram * DARPHANE_WEIGHTS.YARIM * PURITY.KARAT_22;
    const rawTam = rawHasGram * DARPHANE_WEIGHTS.TAM * PURITY.KARAT_22;
    const rawAta = rawHasGram * DARPHANE_WEIGHTS.ATA * PURITY.KARAT_22;
    const rawGremse = rawHasGram * DARPHANE_WEIGHTS.GREMSE * PURITY.KARAT_22;

    const quotes = [
      {
        symbol: 'REF_HAS_ALTIN',
        type: 'Has Altın (24K) [Teorik Spot]',
        asset: 'gold',
        buy: hasGram,
        sell: hasGram,
        last: hasGram,
        spread: 0,
        currency: 'TRY',
        source: 'theoretical-engine',
        priceType: 'indicative',
        isCalculated: true,
        sourceTimestamp: timestamp,
        updatedAt: timestamp,
        formula: '(XAU/USD * USD/TRY) / 31.1034768',
      },
      {
        symbol: 'REF_22_AYAR',
        type: '22 Ayar [Teorik Referans]',
        asset: 'gold',
        buy: Number(raw22k.toFixed(2)),
        sell: Number(raw22k.toFixed(2)),
        last: Number(raw22k.toFixed(2)),
        spread: 0,
        currency: 'TRY',
        source: 'theoretical-engine',
        priceType: 'indicative',
        isCalculated: true,
        sourceTimestamp: timestamp,
        updatedAt: timestamp,
        formula: 'Has Spot * 0.916',
      },
      {
        symbol: 'REF_18_AYAR',
        type: '18 Ayar [Teorik Referans]',
        asset: 'gold',
        buy: Number(raw18k.toFixed(2)),
        sell: Number(raw18k.toFixed(2)),
        last: Number(raw18k.toFixed(2)),
        spread: 0,
        currency: 'TRY',
        source: 'theoretical-engine',
        priceType: 'indicative',
        isCalculated: true,
        sourceTimestamp: timestamp,
        updatedAt: timestamp,
        formula: 'Has Spot * 0.750',
      },
      {
        symbol: 'REF_14_AYAR',
        type: '14 Ayar [Teorik Referans]',
        asset: 'gold',
        buy: Number(raw14k.toFixed(2)),
        sell: Number(raw14k.toFixed(2)),
        last: Number(raw14k.toFixed(2)),
        spread: 0,
        currency: 'TRY',
        source: 'theoretical-engine',
        priceType: 'indicative',
        isCalculated: true,
        sourceTimestamp: timestamp,
        updatedAt: timestamp,
        formula: 'Has Spot * 0.585',
      },
      {
        symbol: 'REF_CEYREK',
        type: 'Çeyrek Altın [Teorik Maden Değeri]',
        asset: 'gold',
        buy: Number(rawCeyrek.toFixed(2)),
        sell: Number(rawCeyrek.toFixed(2)),
        last: Number(rawCeyrek.toFixed(2)),
        spread: 0,
        currency: 'TRY',
        source: 'theoretical-engine',
        priceType: 'indicative',
        isCalculated: true,
        sourceTimestamp: timestamp,
        updatedAt: timestamp,
        formula: 'Has Spot * 1.75g * 0.916 (İşçilik ve basım primi hariç)',
      },
      {
        symbol: 'REF_YARIM',
        type: 'Yarım Altın [Teorik Maden Değeri]',
        asset: 'gold',
        buy: Number(rawYarim.toFixed(2)),
        sell: Number(rawYarim.toFixed(2)),
        last: Number(rawYarim.toFixed(2)),
        spread: 0,
        currency: 'TRY',
        source: 'theoretical-engine',
        priceType: 'indicative',
        isCalculated: true,
        sourceTimestamp: timestamp,
        updatedAt: timestamp,
        formula: 'Has Spot * 3.50g * 0.916 (İşçilik ve basım primi hariç)',
      },
      {
        symbol: 'REF_TAM',
        type: 'Tam Altın [Teorik Maden Değeri]',
        asset: 'gold',
        buy: Number(rawTam.toFixed(2)),
        sell: Number(rawTam.toFixed(2)),
        last: Number(rawTam.toFixed(2)),
        spread: 0,
        currency: 'TRY',
        source: 'theoretical-engine',
        priceType: 'indicative',
        isCalculated: true,
        sourceTimestamp: timestamp,
        updatedAt: timestamp,
        formula: 'Has Spot * 7.00g * 0.916 (İşçilik ve basım primi hariç)',
      },
      {
        symbol: 'REF_ATA',
        type: 'Ata Lira [Teorik Maden Değeri]',
        asset: 'gold',
        buy: Number(rawAta.toFixed(2)),
        sell: Number(rawAta.toFixed(2)),
        last: Number(rawAta.toFixed(2)),
        spread: 0,
        currency: 'TRY',
        source: 'theoretical-engine',
        priceType: 'indicative',
        isCalculated: true,
        sourceTimestamp: timestamp,
        updatedAt: timestamp,
        formula: 'Has Spot * 7.216g * 0.916 (İşçilik ve basım primi hariç)',
      },
      {
        symbol: 'REF_GREMSE',
        type: 'Gremse Altın [Teorik Maden Değeri]',
        asset: 'gold',
        buy: Number(rawGremse.toFixed(2)),
        sell: Number(rawGremse.toFixed(2)),
        last: Number(rawGremse.toFixed(2)),
        spread: 0,
        currency: 'TRY',
        source: 'theoretical-engine',
        priceType: 'indicative',
        isCalculated: true,
        sourceTimestamp: timestamp,
        updatedAt: timestamp,
        formula: 'Has Spot * 17.50g * 0.916 (İşçilik ve basım primi hariç)',
      },
    ];

    return quotes;
  }
}

module.exports = TheoreticalEngine;
module.exports.TROY_OUNCE_GRAMS = TROY_OUNCE_GRAMS;
module.exports.PURITY = PURITY;
module.exports.DARPHANE_WEIGHTS = DARPHANE_WEIGHTS;

