/**
 * Jewelry pricing engine — pure, exact, side-effect free.
 *
 * All inputs and outputs are scaled BigInts (see domain/precision.js):
 *   weightMg (scale 3), purity (scale 4), pricePerGram (scale 4, TRY per
 *   gram at 1000 milyem — the Turkish "has" convention), money minor (scale 2).
 *
 * Gram-priced item, per unit:
 *   metal value = weight(g) × purity × has price
 *   labor (işçilik), one of:
 *     none
 *     per_gram  TRY per gram of gross weight      (laborValue scale 2)
 *     fixed     TRY per piece                      (laborValue scale 2)
 *     milyem    extra fineness added to purity, ‰ (laborValue scale 1),
 *               e.g. 22 ayar sold at 916 + 35 = 951 milyem
 *   The unit price is rounded ONCE to kuruş; the metal/labor breakdown is
 *   derived so that metal + labor == unit price exactly.
 *
 * Line:  gross = unit price × quantity; discount (percent or amount) is
 * rounded once and never exceeds gross; total = gross − discount.
 * Sale-level discounts are allocated to lines proportionally (largest
 * remainder) so returns refund exactly the net value of the returned items.
 */
const {
  roundDiv, parseDecimal, DecimalError, multiply, pow10,
} = require('./decimal');
const { SCALE, ROUNDING_MODE, LIMITS } = require('./precision');
const { PURITY_ONE } = require('./metals');

const LABOR_TYPES = Object.freeze(['none', 'per_gram', 'fixed', 'milyem']);
const PRICING_MODES = Object.freeze(['fixed', 'gram']);

// weightMg (1e3) × purity (1e4) × price (1e4) → TRY; ×100 → kuruş  ⇒ divide by 1e9
const METAL_DIVISOR = pow10(SCALE.WEIGHT + SCALE.PURITY + SCALE.UNIT_PRICE - SCALE.MONEY);

function assertPositive(value, field) {
  if (typeof value !== 'bigint' || value <= 0n) throw new DecimalError(`${field} sıfırdan büyük olmalıdır`, field);
}

function assertNonNegative(value, field) {
  if (typeof value !== 'bigint' || value < 0n) throw new DecimalError(`${field} negatif olamaz`, field);
}

/** Normalises a labor definition; laborValue is a raw API value or a scaled BigInt. */
function parseLabor(laborType = 'none', laborValue) {
  if (!LABOR_TYPES.includes(laborType)) {
    throw new DecimalError(`İşçilik türü ${LABOR_TYPES.join(', ')} değerlerinden biri olmalıdır`, 'laborType');
  }
  if (laborType === 'none') return { laborType, laborValue: 0n };
  const scale = laborType === 'milyem' ? SCALE.MILYEM : SCALE.MONEY;
  const value = typeof laborValue === 'bigint'
    ? laborValue
    : parseDecimal(laborValue ?? 0, scale, { field: 'İşçilik', max: LIMITS.MAX_MONEY_MINOR });
  assertNonNegative(value, 'İşçilik');
  return { laborType, laborValue: value };
}

/**
 * Unit price of a gram-priced item.
 * → { unitPriceMinor, metalValueMinor, laborMinor, fineMg, effectivePurity }
 */
function priceGramUnit({ weightMg, purity, pricePerGram, laborType = 'none', laborValue = 0n }) {
  assertPositive(weightMg, 'Gramaj');
  assertPositive(purity, 'Saflık');
  if (purity > PURITY_ONE) throw new DecimalError('Saflık 1.0000\'dan büyük olamaz', 'purity');
  assertPositive(pricePerGram, 'Gram fiyatı');
  const labor = parseLabor(laborType, laborValue);

  const metalNumerator = weightMg * purity * pricePerGram;
  let numerator = metalNumerator;
  let fixedLaborMinor = 0n;
  let effectivePurity = purity;
  if (labor.laborType === 'milyem') {
    effectivePurity = purity + labor.laborValue; // ‰ at scale 1 == fraction at scale 4
    numerator = weightMg * effectivePurity * pricePerGram;
  } else if (labor.laborType === 'per_gram') {
    // weightMg × kuruş/g / 1000 → expressed over the common divisor
    numerator += weightMg * labor.laborValue * (METAL_DIVISOR / pow10(SCALE.WEIGHT));
  } else if (labor.laborType === 'fixed') {
    fixedLaborMinor = labor.laborValue;
  }

  const unitPriceMinor = roundDiv(numerator, METAL_DIVISOR, ROUNDING_MODE) + fixedLaborMinor;
  const metalValueMinor = roundDiv(metalNumerator, METAL_DIVISOR, ROUNDING_MODE);
  return {
    unitPriceMinor,
    metalValueMinor,
    laborMinor: unitPriceMinor - metalValueMinor,
    fineMg: roundDiv(weightMg * purity, PURITY_ONE, ROUNDING_MODE),
    effectivePurity,
  };
}

/**
 * Discount definition → minor amount on `grossMinor`.
 *   { type: 'percent', value: '12.5' } (0–100 %, scale 2)
 *   { type: 'amount',  value: '150.00' }
 */
function computeDiscount(grossMinor, discount) {
  if (!discount || discount.value === undefined || discount.value === null || discount.value === '' || discount.value === 0) return 0n;
  const type = discount.type || 'amount';
  if (type === 'percent') {
    const bp = parseDecimal(discount.value, SCALE.PERCENT, { field: 'İndirim oranı', max: 10000n });
    return roundDiv(grossMinor * bp, 10000n, ROUNDING_MODE);
  }
  if (type === 'amount') {
    const amount = parseDecimal(discount.value, SCALE.MONEY, { field: 'İndirim tutarı' });
    if (amount > grossMinor) throw new DecimalError('İndirim tutarı satır/satış tutarını aşamaz', 'discount');
    return amount;
  }
  throw new DecimalError('İndirim türü percent veya amount olmalıdır', 'discount');
}

/** Line amounts from a unit price. */
function priceLine({ unitPriceMinor, quantity, discount }) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > LIMITS.MAX_QUANTITY) {
    throw new DecimalError('Miktar pozitif bir tam sayı olmalıdır', 'quantity');
  }
  assertNonNegative(unitPriceMinor, 'Birim fiyat');
  const grossMinor = unitPriceMinor * BigInt(quantity);
  const discountMinor = computeDiscount(grossMinor, discount);
  return { grossMinor, discountMinor, totalMinor: grossMinor - discountMinor };
}

/**
 * Splits `amount` across `weights` proportionally using the largest
 * remainder method; the parts always sum exactly to `amount`.
 */
function allocateProportionally(amount, weights) {
  const total = weights.reduce((s, w) => s + w, 0n);
  if (amount === 0n || total === 0n) return weights.map(() => 0n);
  if (amount > total) throw new DecimalError('Dağıtılacak tutar toplamı aşıyor', 'discount');
  const raw = weights.map((w, index) => ({ index, floor: (amount * w) / total, remainder: (amount * w) % total }));
  let left = amount - raw.reduce((s, r) => s + r.floor, 0n);
  const order = [...raw].sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : a.index - b.index));
  const parts = raw.map((r) => r.floor);
  for (const r of order) {
    if (left === 0n) break;
    parts[r.index] += 1n;
    left -= 1n;
  }
  return parts;
}

/**
 * Buy-back price of metal (scrap / hurda alımı):
 *   amount = weight × (purity − deduction) × buy price per gram
 * `deductionMilyem` (scale 1) models fire/melting loss (fire düşümü).
 */
function priceMetalPurchase({ weightMg, purity, pricePerGram, deductionMilyem = 0n }) {
  assertPositive(weightMg, 'Gramaj');
  assertPositive(purity, 'Saflık');
  assertPositive(pricePerGram, 'Alış fiyatı');
  assertNonNegative(deductionMilyem, 'Fire düşümü');
  const effective = purity - deductionMilyem;
  if (effective <= 0n) throw new DecimalError('Fire düşümü saflıktan büyük olamaz', 'deduction');
  return {
    amountMinor: roundDiv(weightMg * effective * pricePerGram, METAL_DIVISOR, ROUNDING_MODE),
    fineMg: roundDiv(weightMg * purity, PURITY_ONE, ROUNDING_MODE),
    effectivePurity: effective,
  };
}

/** Converts a minor amount with an FX rate (scale 6), rounding once to the target minor unit. */
function convertCurrency(amountMinor, rate) {
  assertNonNegative(amountMinor, 'Tutar');
  assertPositive(rate, 'Kur');
  return multiply(amountMinor, SCALE.MONEY, rate, SCALE.RATE, SCALE.MONEY, ROUNDING_MODE);
}

/** Percentage (scale 2) of a minor amount, rounded once. */
function percentOf(amountMinor, percent) {
  return roundDiv(amountMinor * percent, 10000n, ROUNDING_MODE);
}

module.exports = {
  LABOR_TYPES,
  PRICING_MODES,
  METAL_DIVISOR,
  parseLabor,
  priceGramUnit,
  computeDiscount,
  priceLine,
  allocateProportionally,
  priceMetalPurchase,
  convertCurrency,
  percentOf,
};
