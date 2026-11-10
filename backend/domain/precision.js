/**
 * Financial precision and rounding policy — the single source of truth.
 * Rationale and examples: backend/BUSINESS_RULES.md → "Precision & rounding".
 *
 * Stored representation (integers only, never floats):
 *   money        kuruş            (scale 2)   12345   = 123.45 TRY
 *   weight       milligrams       (scale 3)   1750    = 1.750 g
 *   fine metal   milligrams fine  (scale 3)   1603    = 1.603 g has
 *   purity       1/10 000         (scale 4)   9160    = 0.9160 (22 ayar)
 *
 * Calculation inputs (parsed exactly, never stored as floats):
 *   unit prices  scale 4   price per gram, e.g. 6562.5300 TRY/g
 *   FX rates     scale 6   e.g. 50.210400 TRY/USD
 *   percentages  scale 2   e.g. 12.50 %  (= 1250 basis points)
 *   labor milyem scale 1   e.g. 35.0 ‰ added fineness
 *
 * Rounding: HALF_UP (commercial rounding), applied ONCE per computed amount
 * — a line's unit price, a discount, a conversion — never on intermediate
 * results. Totals are exact sums of already-rounded amounts.
 */
const { ROUNDING } = require('./decimal');

const SCALE = Object.freeze({
  MONEY: 2,
  WEIGHT: 3,
  FINE: 3,
  PURITY: 4,
  UNIT_PRICE: 4,
  RATE: 6,
  PERCENT: 2,
  MILYEM: 1,
});

const ROUNDING_MODE = ROUNDING.HALF_UP;

// Hard plausibility limits for user input (reject typos such as an extra zero
// group); they are deliberately generous.
const LIMITS = Object.freeze({
  MAX_MONEY_MINOR: 10_000_000_000_00n,       // 10 billion TRY per amount
  MAX_WEIGHT_MG: 1_000_000_000n,             // 1 000 kg per line
  MAX_QUANTITY: 100_000,
  MAX_UNIT_PRICE: 100_000_000_0000n,         // 100 million TRY per gram/unit (scale 4)
  MAX_RATE: 1_000_000_000000n,               // FX rate up to 1 million (scale 6)
});

const UNITS = Object.freeze({
  TRY: 'TRY',
  XAU: 'XAU', // fine gold, milligrams
  XAG: 'XAG', // fine silver, milligrams
});

module.exports = { SCALE, ROUNDING_MODE, LIMITS, UNITS };
