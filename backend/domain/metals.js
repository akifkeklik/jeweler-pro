/**
 * Precious metals: purity, karat conversion and fine-metal content.
 *
 * Purity is stored in parts per 10 000 (scale 4): 9160 = 0.916 = 916 milyem.
 *
 * Trade standards, not theoretical karat/24 values, are used for karats:
 * 22 ayar is sold and assayed as 916 (not 916.67), 14 ayar as 585 (not
 * 583.3). 24 ayar maps to 995 ("has" in Turkish retail); 999.9 bullion must
 * be selected explicitly. These presets can be overridden per item with an
 * explicit purity — an assay result always wins over a karat label.
 */
const { roundDiv, parseDecimal, DecimalError } = require('./decimal');
const { SCALE, ROUNDING_MODE } = require('./precision');

const METALS = Object.freeze({
  XAU: Object.freeze({ code: 'XAU', name: 'Altın', marketSymbol: 'HAS_ALTIN' }),
  XAG: Object.freeze({ code: 'XAG', name: 'Gümüş', marketSymbol: 'GUMUS_GRAM' }),
});

const PURITY_ONE = 10000n; // 1.0000

const PURITY_PRESETS = Object.freeze([
  { code: 'XAU_9999', metal: 'XAU', label: '24 Ayar Külçe (999.9)', karat: 24, purity: 9999 },
  { code: 'XAU_995', metal: 'XAU', label: '24 Ayar Has (995)', karat: 24, purity: 9950 },
  { code: 'XAU_916', metal: 'XAU', label: '22 Ayar (916)', karat: 22, purity: 9160 },
  { code: 'XAU_750', metal: 'XAU', label: '18 Ayar (750)', karat: 18, purity: 7500 },
  { code: 'XAU_585', metal: 'XAU', label: '14 Ayar (585)', karat: 14, purity: 5850 },
  { code: 'XAU_375', metal: 'XAU', label: '9 Ayar (375)', karat: 9, purity: 3750 },
  { code: 'XAU_333', metal: 'XAU', label: '8 Ayar (333)', karat: 8, purity: 3330 },
  { code: 'XAG_999', metal: 'XAG', label: 'Gümüş 999', karat: null, purity: 9990 },
  { code: 'XAG_925', metal: 'XAG', label: 'Gümüş 925 (Ayar)', karat: null, purity: 9250 },
  { code: 'XAG_900', metal: 'XAG', label: 'Gümüş 900', karat: null, purity: 9000 },
  { code: 'XAG_800', metal: 'XAG', label: 'Gümüş 800', karat: null, purity: 8000 },
].map((preset) => Object.freeze(preset)));

const KARAT_TO_PURITY = Object.freeze({ 24: 9950, 22: 9160, 18: 7500, 14: 5850, 9: 3750, 8: 3330 });

function assertMetal(metal) {
  if (!Object.prototype.hasOwnProperty.call(METALS, metal)) {
    throw new DecimalError('Geçersiz maden türü (XAU veya XAG olmalıdır)', 'metal');
  }
  return metal;
}

/** Trade-standard purity (scale 4, as BigInt) for a gold karat. */
function karatToPurity(karat) {
  const value = Number(karat);
  if (!Object.prototype.hasOwnProperty.call(KARAT_TO_PURITY, value)) {
    throw new DecimalError(`Desteklenmeyen ayar: ${karat}. Desteklenen ayarlar: ${Object.keys(KARAT_TO_PURITY).join(', ')}`, 'karat');
  }
  return BigInt(KARAT_TO_PURITY[value]);
}

/** Milyem (‰, e.g. "916" or "999.9") → purity scale 4. */
function milyemToPurity(milyem) {
  const scaled = parseDecimal(milyem, SCALE.MILYEM, { field: 'Milyem', allowZero: false });
  const purity = scaled; // scale 1 ‰ == scale 4 fraction (916.0‰ = 9160 / 10000)
  if (purity > PURITY_ONE) throw new DecimalError('Milyem 1000\'den büyük olamaz', 'milyem');
  return purity;
}

/**
 * Accepts { purity } (fraction, "0.916"), { milyem } ("916") or { karat } (22)
 * and returns purity scale 4 as BigInt.
 */
function resolvePurity({ purity, milyem, karat } = {}) {
  let resolved;
  if (purity !== undefined && purity !== null && purity !== '') {
    resolved = parseDecimal(purity, SCALE.PURITY, { field: 'Saflık', allowZero: false });
  } else if (milyem !== undefined && milyem !== null && milyem !== '') {
    resolved = milyemToPurity(milyem);
  } else if (karat !== undefined && karat !== null && karat !== '') {
    resolved = karatToPurity(karat);
  } else {
    throw new DecimalError('Saflık (purity), milyem veya ayar belirtilmelidir', 'purity');
  }
  if (resolved > PURITY_ONE) throw new DecimalError('Saflık 1.0000\'dan büyük olamaz', 'purity');
  return resolved;
}

/** Fine metal content in mg: weight (mg) × purity, rounded once. */
function fineWeightMg(weightMg, purity) {
  return roundDiv(weightMg * purity, PURITY_ONE, ROUNDING_MODE);
}

/** Gross weight needed for a given fine content at a purity (e.g. has → 22K). */
function grossForFineMg(fineMg, purity) {
  if (purity <= 0n) throw new RangeError('Purity must be positive');
  return roundDiv(fineMg * PURITY_ONE, purity, ROUNDING_MODE);
}

module.exports = {
  METALS,
  PURITY_ONE,
  PURITY_PRESETS,
  KARAT_TO_PURITY,
  assertMetal,
  karatToPurity,
  milyemToPurity,
  resolvePurity,
  fineWeightMg,
  grossForFineMg,
};
