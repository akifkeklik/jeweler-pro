/**
 * Financial domain engine — pure unit tests (no database).
 * Expected values are computed by hand in the comments; none come from the
 * implementation under test.
 */
const { inspect } = require('../testSupport/tenantInspection');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  ROUNDING, roundDiv, parseDecimal, rescale, multiply, format, toSafeInteger, toDisplayNumber,
} = require('../domain/decimal');
const {
  karatToPurity, milyemToPurity, resolvePurity, fineWeightMg, grossForFineMg, PURITY_PRESETS,
} = require('../domain/metals');
const {
  priceGramUnit, priceLine, computeDiscount, allocateProportionally, priceMetalPurchase, convertCurrency, percentOf,
} = require('../domain/pricing');
const { liveQuoteFrom, manualQuote, resolveMetalPrices } = require('../services/finance/metalPricing');
const LedgerEntry = inspect(require('../models/LedgerEntry'));

const g = (text) => parseDecimal(text, 3); // grams → mg
const tl = (text) => parseDecimal(text, 2); // TRY → kuruş
const p4 = (text) => parseDecimal(text, 4); // price per gram → scale 4

describe('Decimal arithmetic', () => {
  it('avoids binary floating point errors', () => {
    assert.equal(0.1 + 0.2 === 0.3, false, 'sanity: JS floats are inexact');
    assert.equal(format(tl('0.1') + tl('0.2'), 2), '0.30');
    assert.equal(format(tl('1.10') * 3n, 2), '3.30');
    assert.equal(format(parseDecimal(0.1, 2) * 3n, 2), '0.30');
  });

  it('parses strictly: rejects excess precision, exponents, separators, NaN/Infinity, negatives', () => {
    for (const bad of ['1.005', '1e3', '1,50', '1 000', 'NaN', 'Infinity', '', ' . ', '+', '--1', '0x10', null, undefined, {}, [], true]) {
      assert.throws(() => parseDecimal(bad, 2), /./, JSON.stringify(bad));
    }
    assert.throws(() => parseDecimal(Infinity, 2));
    assert.throws(() => parseDecimal('-1', 2), /negatif/);
    assert.equal(parseDecimal('-1.5', 2, { allowNegative: true }), -150n);
    assert.throws(() => parseDecimal('0', 2, { allowZero: false }), /sıfırdan büyük/);
    assert.throws(() => parseDecimal(10n, 2), /ondalık/);
    assert.throws(() => parseDecimal('99999999999999999', 2), /güvenli/);
  });

  it('rounds only when explicitly allowed, HALF_UP by default', () => {
    assert.equal(parseDecimal('1.005', 2, { round: true }), 101n);
    assert.equal(parseDecimal('1.0049', 2, { round: true }), 100n);
    assert.equal(roundDiv(5n, 2n), 3n);
    assert.equal(roundDiv(-5n, 2n), -3n, 'half away from zero');
    assert.equal(roundDiv(5n, 2n, ROUNDING.HALF_EVEN), 2n);
    assert.equal(roundDiv(7n, 2n, ROUNDING.HALF_EVEN), 4n);
    assert.equal(roundDiv(7n, 2n, ROUNDING.DOWN), 3n);
    assert.equal(rescale(12345n, 3, 1), 123n, '12.345 → 12.3');
    assert.equal(rescale(12350n, 3, 1), 124n, '12.350 → 12.4 (half up)');
    assert.equal(multiply(150n, 2, 1250n, 2, 2), 1875n, '1.50 × 12.50 = 18.75');
  });

  it('formats exactly and converts to display numbers only at the edge', () => {
    assert.equal(format(-5n, 2), '-0.05');
    assert.equal(format(0n, 3), '0.000');
    assert.equal(format(123456n, 0), '123456');
    assert.equal(toDisplayNumber(12345n, 2), 123.45);
    assert.throws(() => toSafeInteger(BigInt(Number.MAX_SAFE_INTEGER) + 1n));
  });
});

describe('Purity, karat and fine content', () => {
  it('maps karats to trade standards and accepts milyem / fraction input', () => {
    assert.equal(karatToPurity(22), 9160n);
    assert.equal(karatToPurity(18), 7500n);
    assert.equal(karatToPurity(14), 5850n);
    assert.equal(karatToPurity(24), 9950n);
    assert.throws(() => karatToPurity(21), /Desteklenmeyen ayar/);
    assert.equal(milyemToPurity('916'), 9160n);
    assert.equal(milyemToPurity('999.9'), 9999n);
    assert.throws(() => milyemToPurity('1000.1'));
    assert.equal(resolvePurity({ purity: '0.585' }), 5850n);
    assert.equal(resolvePurity({ milyem: '750' }), 7500n);
    assert.equal(resolvePurity({ karat: 22 }), 9160n);
    assert.throws(() => resolvePurity({}), /Saflık/);
    assert.throws(() => resolvePurity({ purity: '1.0001' }), /1.0000/);
    assert.ok(PURITY_PRESETS.every((p) => p.purity > 0 && p.purity <= 10000));
  });

  it('computes fine gold exactly and rounds once', () => {
    // Çeyrek: 1.750 g × 0.916 = 1.603 g has
    assert.equal(fineWeightMg(g('1.750'), 9160n), 1603n);
    // 10.000 g × 0.585 = 5.850 g
    assert.equal(fineWeightMg(g('10'), 5850n), 5850n);
    // 0.001 g × 0.916 = 0.000916 g → 0.001 g (HALF_UP on mg)
    assert.equal(fineWeightMg(1n, 9160n), 1n);
    // 1.603 g has needs 1.603/0.916 = 1.75 g of 22K
    assert.equal(grossForFineMg(1603n, 9160n), 1750n);
  });
});

describe('Gram pricing', () => {
  const has = p4('6562.53'); // TRY per gram has

  it('metal only: 10 g 22 ayar = 10 × 0.916 × 6562.53 = 60112.77 (60112.7748)', () => {
    const r = priceGramUnit({ weightMg: g('10'), purity: 9160n, pricePerGram: has });
    assert.equal(format(r.unitPriceMinor, 2), '60112.77');
    assert.equal(r.laborMinor, 0n);
    assert.equal(r.fineMg, 9160n);
  });

  it('milyem labor: 10 g 22 ayar + 35‰ = 10 × 0.951 × 6562.53 = 62409.66 (62409.6603)', () => {
    const r = priceGramUnit({ weightMg: g('10'), purity: 9160n, pricePerGram: has, laborType: 'milyem', laborValue: '35' });
    assert.equal(format(r.unitPriceMinor, 2), '62409.66');
    assert.equal(format(r.metalValueMinor, 2), '60112.77');
    assert.equal(r.metalValueMinor + r.laborMinor, r.unitPriceMinor, 'breakdown sums exactly');
    assert.equal(r.effectivePurity, 9510n);
  });

  it('per-gram labor: 7.25 g 14 ayar, 150 TL/g = 7.25×0.585×6562.53 + 7.25×150 = 27833.3304 + 1087.50 → 28920.83', () => {
    // 7.25 × 0.585 = 4.24125 g has × 6562.53 = 27833.33036… ; labor 1087.50 ; total 28920.83036… → 28920.83
    const r = priceGramUnit({ weightMg: g('7.25'), purity: 5850n, pricePerGram: has, laborType: 'per_gram', laborValue: '150' });
    assert.equal(format(r.unitPriceMinor, 2), '28920.83');
    assert.equal(format(r.metalValueMinor, 2), '27833.33');
    assert.equal(r.metalValueMinor + r.laborMinor, r.unitPriceMinor);
  });

  it('fixed labor is added exactly', () => {
    const r = priceGramUnit({ weightMg: g('1.75'), purity: 9160n, pricePerGram: has, laborType: 'fixed', laborValue: '250.00' });
    // 1.75 × 0.916 × 6562.53 = 10519.7355… → 10519.74 + 250.00
    assert.equal(format(r.unitPriceMinor, 2), '10769.74');
    assert.equal(format(r.laborMinor, 2), '250.00');
  });

  it('rejects invalid inputs', () => {
    assert.throws(() => priceGramUnit({ weightMg: 0n, purity: 9160n, pricePerGram: has }));
    assert.throws(() => priceGramUnit({ weightMg: 1000n, purity: 10001n, pricePerGram: has }));
    assert.throws(() => priceGramUnit({ weightMg: 1000n, purity: 9160n, pricePerGram: 0n }));
    assert.throws(() => priceGramUnit({ weightMg: 1000n, purity: 9160n, pricePerGram: has, laborType: 'tip' }));
    assert.throws(() => priceGramUnit({ weightMg: 1000n, purity: 9160n, pricePerGram: has, laborType: 'fixed', laborValue: '-5' }));
  });
});

describe('Discounts, allocation, conversions', () => {
  it('line amounts: unit × quantity, percent and amount discounts rounded once, never above gross', () => {
    const line = priceLine({ unitPriceMinor: tl('33.33'), quantity: 3, discount: { type: 'percent', value: '10' } });
    assert.equal(line.grossMinor, 9999n);
    assert.equal(line.discountMinor, 1000n, '10% of 99.99 = 9.999 → 10.00');
    assert.equal(line.totalMinor, 8999n);
    assert.equal(computeDiscount(1000n, { type: 'amount', value: '10.00' }), 1000n);
    assert.throws(() => computeDiscount(1000n, { type: 'amount', value: '10.01' }), /aşamaz/);
    assert.throws(() => computeDiscount(1000n, { type: 'percent', value: '100.01' }));
    assert.throws(() => priceLine({ unitPriceMinor: 100n, quantity: 0 }));
    assert.throws(() => priceLine({ unitPriceMinor: 100n, quantity: 1.5 }));
  });

  it('proportional allocation always sums exactly (property check, 2 000 random cases)', () => {
    for (let i = 0; i < 2000; i += 1) {
      const weights = Array.from({ length: 1 + crypto.randomInt(8) }, () => BigInt(crypto.randomInt(1, 10_000_000)));
      const total = weights.reduce((s, w) => s + w, 0n);
      const amount = BigInt(crypto.randomInt(0, Number(total < 1_000_000_000n ? total : 1_000_000_000n) + 1));
      const parts = allocateProportionally(amount, weights);
      assert.equal(parts.reduce((s, x) => s + x, 0n), amount);
      parts.forEach((part, k) => assert.ok(part >= 0n && part <= weights[k], `part within its line (${part} ≤ ${weights[k]})`));
    }
    assert.deepEqual(allocateProportionally(100n, [100n, 100n, 100n]), [34n, 33n, 33n]);
    assert.throws(() => allocateProportionally(100n, [1n, 1n, 1n]), /aşıyor/, 'cannot allocate more than the total');
  });

  it('scrap buy-back: weight × (purity − fire) × buy price', () => {
    // 12.40 g 22 ayar, 6561.74 alış, 10‰ fire: 12.4 × 0.906 × 6561.74 = 73717.2085… → 73717.21
    const r = priceMetalPurchase({ weightMg: g('12.40'), purity: 9160n, pricePerGram: p4('6561.74'), deductionMilyem: parseDecimal('10', 1) });
    assert.equal(format(r.amountMinor, 2), '73717.21');
    assert.equal(r.fineMg, 11358n, 'fine content is the assayed purity, before fire');
    assert.throws(() => priceMetalPurchase({ weightMg: 1000n, purity: 9160n, pricePerGram: p4('1'), deductionMilyem: 9160n }));
  });

  it('currency conversion and percentages round once to the minor unit', () => {
    // 1 234.56 USD × 50.210400 = 61987.75… → 61987.75
    assert.equal(format(convertCurrency(tl('1234.56'), parseDecimal('50.2104', 6)), 2), '61987.75');
    assert.equal(percentOf(tl('200.00'), parseDecimal('2.5', 2)), 500n);
  });
});

describe('Live price rules', () => {
  const now = Date.now();
  const quote = (patch = {}) => ({
    preferredQuotes: [{
      symbol: 'HAS_ALTIN', buy: 6561.74, sell: 6562.53, source: 'genelpara', priceType: 'live', isStale: false,
      sourceTimestamp: new Date(now - 30_000).toISOString(), ...patch,
    }],
  });

  it('accepts a fresh live quote and snapshots both sides', () => {
    const q = liveQuoteFrom(quote(), 'XAU', 'sell', now);
    assert.equal(q.pricePerGramText, '6562.5300');
    assert.equal(q.quotedBuy, '6561.74');
    assert.equal(liveQuoteFrom(quote(), 'XAU', 'buy', now).pricePerGramText, '6561.7400');
  });

  it('never uses stale, cached, indicative, old, future or missing quotes', () => {
    assert.equal(liveQuoteFrom(quote({ isStale: true }), 'XAU', 'sell', now), null);
    assert.equal(liveQuoteFrom(quote({ priceType: 'cached' }), 'XAU', 'sell', now), null);
    assert.equal(liveQuoteFrom(quote({ priceType: 'indicative', isCalculated: true }), 'XAU', 'sell', now), null);
    assert.equal(liveQuoteFrom(quote({ sourceTimestamp: new Date(now - 6 * 60_000).toISOString() }), 'XAU', 'sell', now), null);
    assert.equal(liveQuoteFrom(quote({ sourceTimestamp: new Date(now + 10 * 60_000).toISOString() }), 'XAU', 'sell', now), null);
    assert.equal(liveQuoteFrom(quote({ sourceTimestamp: null, updatedAt: null }), 'XAU', 'sell', now), null);
    assert.equal(liveQuoteFrom({ preferredQuotes: [] }, 'XAU', 'sell', now), null);
  });

  it('missing live price → 409 MARKET_PRICE_UNAVAILABLE; explicit manual price is labelled manual', async () => {
    await assert.rejects(
      resolveMetalPrices(['XAU'], 'sell', { quoteSource: async () => quote({ isStale: true }) }),
      (error) => error.statusCode === 409 && error.code === 'MARKET_PRICE_UNAVAILABLE',
    );
    await assert.rejects(
      resolveMetalPrices(['XAU'], 'sell', { quoteSource: async () => { throw new Error('network down'); } }),
      (error) => error.code === 'MARKET_PRICE_UNAVAILABLE',
    );
    const prices = await resolveMetalPrices(['XAU'], 'sell', { manualPrices: { XAU: '6600.00' }, quoteSource: async () => { throw new Error('unused'); } });
    assert.equal(prices.XAU.priceType, 'manual');
    assert.throws(() => manualQuote('XAU', 'sell', '0'));
    assert.throws(() => manualQuote('XPT', 'sell', '10'));
  });
});

describe('Ledger entry invariants (schema level)', () => {
  const base = { businessId: 'b', branch: 'x', entryType: 'expense' };

  // validate() (not validateSync) — the balance rule is a pre-validate hook,
  // which is what every save() runs.
  it('rejects unbalanced, one-sided, mixed and single-line entries', async () => {
    const cases = [
      [{ account: 'cash:x', unit: 'TRY', debit: 100 }, { account: 'expense:genel', unit: 'TRY', credit: 99 }],
      [{ account: 'cash:x', unit: 'TRY', debit: 100, credit: 100 }, { account: 'expense:genel', unit: 'TRY', credit: 0 }],
      [{ account: 'cash:x', unit: 'TRY', debit: 100 }],
      [{ account: 'cash:x', unit: 'TRY', debit: 100 }, { account: 'vault:x', unit: 'XAU', credit: 100 }],
      [{ account: 'cash:x', unit: 'TRY', debit: 1.5 }, { account: 'expense:genel', unit: 'TRY', credit: 1.5 }],
    ];
    for (const lines of cases) {
      await assert.rejects(new LedgerEntry({ ...base, lines }).validate(), /./, JSON.stringify(lines));
    }
  });

  it('accepts entries balanced per unit (TRY and XAU in one entry)', async () => {
    const entry = new LedgerEntry({
      ...base,
      lines: [
        { account: 'cash:x', unit: 'TRY', debit: 500 }, { account: 'ar:1', unit: 'TRY', credit: 500 },
        { account: 'vault:x', unit: 'XAU', debit: 1603 }, { account: 'ar:1', unit: 'XAU', credit: 1603 },
      ],
    });
    await entry.validate();
  });

  it('journal entries are immutable once created', () => {
    assert.equal(LedgerEntry.schema.path('lines').options.immutable, true);
    assert.equal(LedgerEntry.schema.path('entryType').options.immutable, true);
    assert.equal(LedgerEntry.schema.options.strict, 'throw');
  });
});
