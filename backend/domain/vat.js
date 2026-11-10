/**
 * KDV (VAT) engine: pure functions, BigInt kuruş, HALF_UP, no I/O.
 *
 * Retail prices in Turkey are quoted VAT-inclusive ("KDV dahil"), so the
 * engine SPLITS a gross amount into matrah (net base) + KDV; it never adds
 * VAT on top of a price.
 *
 * VAT classes (per product: explicit `vatClass`, or derived by `auto`):
 *
 *   exempt       → no VAT.                       e.g. has/külçe altın (≥ 995, no labour)
 *   gold_margin  → VAT only on (gross − metal value), i.e. on the labour /
 *                  margin part.                   e.g. altın ziynet eşyası, sikke
 *   full         → VAT on the whole gross.       e.g. gümüş takı, pırlanta, aksesuar
 *
 * ASSUMPTIONS: MUST be confirmed in writing by the business's mali müşavir
 * before VAT is enabled (BusinessProfile.vat.enabled defaults to false):
 *   A1. Külçe/has gold (purity ≥ 995, no labour) is exempt (KDVK 17/4-g).
 *   A2. Gold jewellery and coins: matrah excludes the gold value (KDVK 23/e);
 *       the gold value is the metal part of the sale-time price snapshot.
 *   A3. Everything else (silver, gemstones, accessories) is taxed on the
 *       full price at the standard rate.
 *   A4. A gold item without a metal breakdown (fixed price) cannot be split
 *       safely; `auto` then taxes the full price and marks the basis
 *       `gross_no_metal_value` so the receipt and reports make it visible.
 *       Set the product's vatClass explicitly to change this.
 */
const { roundDiv, ROUNDING } = require('./decimal');

const VAT_CLASSES = Object.freeze(['auto', 'exempt', 'gold_margin', 'full']);
const BASIS_POINTS = 10000n;
/** Standard Turkish VAT rate since 10 July 2023: 20 %. Configurable per business. */
const DEFAULT_STANDARD_RATE_BP = 2000;
const BULLION_MIN_PURITY = 9950;

function assertRate(rateBp) {
  if (!Number.isSafeInteger(rateBp) || rateBp < 0 || rateBp > 10000) {
    throw new RangeError('KDV oranı 0–10000 baz puan aralığında olmalıdır');
  }
  return BigInt(rateBp);
}

/** Resolves `auto` to a concrete class from the product's metal data. */
function resolveVatClass(product = {}) {
  const explicit = product.vatClass;
  if (explicit && explicit !== 'auto') {
    if (!VAT_CLASSES.includes(explicit)) throw new RangeError(`Bilinmeyen KDV sınıfı: ${explicit}`);
    return explicit;
  }
  if (product.metal === 'XAU') {
    const noLabour = !product.laborType || product.laborType === 'none';
    if (Number(product.purity) >= BULLION_MIN_PURITY && noLabour) return 'exempt';
    return 'gold_margin';
  }
  return 'full';
}

/**
 * VAT contained in a VAT-inclusive amount: gross × r / (1 + r), rounded once.
 */
function vatIncluded(grossMinor, rateBp) {
  const rate = assertRate(rateBp);
  const gross = BigInt(grossMinor);
  if (gross <= 0n || rate === 0n) return 0n;
  return roundDiv(gross * rate, BASIS_POINTS + rate, ROUNDING.HALF_UP);
}

/**
 * VAT breakdown of one sale line (after all discounts).
 * @param {object} p
 * @param {bigint|number} p.totalMinor        line total, VAT-inclusive, after discounts
 * @param {bigint|number|null} [p.metalValueMinor] metal value of the WHOLE line (null = unknown)
 * @param {string} p.vatClass                 resolved class (see resolveVatClass)
 * @param {number} p.rateBp                   rate in basis points (2000 = 20 %)
 * @returns {{ vatClass, rateBp, basis, taxableGrossMinor, vatMinor, netMinor }}
 */
function lineVat({ totalMinor, metalValueMinor = null, vatClass, rateBp }) {
  const total = BigInt(totalMinor);
  if (total < 0n) throw new RangeError('Satır tutarı negatif olamaz');
  let taxableGross;
  let basis;
  if (vatClass === 'exempt') {
    taxableGross = 0n;
    basis = 'exempt';
  } else if (vatClass === 'gold_margin') {
    if (metalValueMinor === null || metalValueMinor === undefined) {
      taxableGross = total;
      basis = 'gross_no_metal_value';
    } else {
      const metal = BigInt(metalValueMinor);
      // A discount below the gold value leaves no taxable margin (never negative).
      taxableGross = total > metal ? total - metal : 0n;
      basis = 'margin';
    }
  } else if (vatClass === 'full') {
    taxableGross = total;
    basis = 'gross';
  } else {
    throw new RangeError(`Bilinmeyen KDV sınıfı: ${vatClass}`);
  }
  const effectiveRate = vatClass === 'exempt' ? 0 : rateBp;
  const vat = vatIncluded(taxableGross, effectiveRate);
  return {
    vatClass,
    rateBp: effectiveRate,
    basis,
    taxableGrossMinor: taxableGross,
    vatMinor: vat,
    netMinor: total - vat,
  };
}

/** Sums line breakdowns into per-rate and grand totals (for receipts / e-Arşiv). */
function summarize(lines) {
  const byRate = new Map();
  let vatMinor = 0n;
  let taxableGrossMinor = 0n;
  for (const l of lines) {
    vatMinor += BigInt(l.vatMinor);
    taxableGrossMinor += BigInt(l.taxableGrossMinor);
    const key = `${l.rateBp}`;
    const bucket = byRate.get(key) || { rateBp: l.rateBp, taxableGrossMinor: 0n, vatMinor: 0n };
    bucket.taxableGrossMinor += BigInt(l.taxableGrossMinor);
    bucket.vatMinor += BigInt(l.vatMinor);
    byRate.set(key, bucket);
  }
  return { vatMinor, taxableGrossMinor, byRate: [...byRate.values()].sort((a, b) => a.rateBp - b.rateBp) };
}

/** VAT share of a partial return: proportional, cumulative (returning all units returns all VAT). */
function returnedVat(lineVatMinor, quantity, alreadyReturned, returning) {
  const vat = BigInt(lineVatMinor);
  const q = BigInt(quantity);
  const portion = (n) => roundDiv(vat * BigInt(n), q, ROUNDING.HALF_UP);
  return portion(alreadyReturned + returning) - portion(alreadyReturned);
}

module.exports = {
  VAT_CLASSES,
  DEFAULT_STANDARD_RATE_BP,
  BULLION_MIN_PURITY,
  resolveVatClass,
  vatIncluded,
  lineVat,
  summarize,
  returnedVat,
};
