/**
 * KDV engine — expected figures are computed by hand in the comments.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveVatClass, vatIncluded, lineVat, summarize, returnedVat } = require('../domain/vat');

test('VAT contained in a VAT-inclusive price (20 %)', () => {
  // 1 200.00 TL incl. 20 % → 1200 × 20/120 = 200.00
  assert.equal(vatIncluded(120000n, 2000), 20000n);
  // 100.00 TL → 16.666… → 16.67 (HALF_UP)
  assert.equal(vatIncluded(10000n, 2000), 1667n);
  assert.equal(vatIncluded(0n, 2000), 0n);
  assert.equal(vatIncluded(10000n, 0), 0n);
  assert.throws(() => vatIncluded(100n, -1), RangeError);
  assert.throws(() => vatIncluded(100n, 1.5), RangeError);
});

test('auto classification: bullion exempt, gold jewellery margin, everything else full', () => {
  assert.equal(resolveVatClass({ metal: 'XAU', purity: 9950, laborType: 'none' }), 'exempt');
  assert.equal(resolveVatClass({ metal: 'XAU', purity: 9999 }), 'exempt');
  assert.equal(resolveVatClass({ metal: 'XAU', purity: 9950, laborType: 'per_gram' }), 'gold_margin');
  assert.equal(resolveVatClass({ metal: 'XAU', purity: 9160, laborType: 'milyem' }), 'gold_margin');
  assert.equal(resolveVatClass({ metal: 'XAG', purity: 9250 }), 'full');
  assert.equal(resolveVatClass({ name: 'Pırlanta' }), 'full');
  // Explicit class wins over the derivation.
  assert.equal(resolveVatClass({ metal: 'XAU', purity: 9160, vatClass: 'full' }), 'full');
  assert.throws(() => resolveVatClass({ vatClass: 'zero' }), RangeError);
});

test('gold jewellery: VAT only on the labour/margin part', () => {
  // 22 ayar bilezik: line 10 000.00, gold value 8 800.00 → margin 1 200.00
  // VAT = 1200 × 20/120 = 200.00; net = 9 800.00
  const v = lineVat({ totalMinor: 1000000n, metalValueMinor: 880000n, vatClass: 'gold_margin', rateBp: 2000 });
  assert.equal(v.basis, 'margin');
  assert.equal(v.taxableGrossMinor, 120000n);
  assert.equal(v.vatMinor, 20000n);
  assert.equal(v.netMinor, 980000n);
});

test('gold jewellery discounted below its gold value has no taxable margin', () => {
  const v = lineVat({ totalMinor: 850000n, metalValueMinor: 880000n, vatClass: 'gold_margin', rateBp: 2000 });
  assert.equal(v.taxableGrossMinor, 0n);
  assert.equal(v.vatMinor, 0n);
});

test('gold without a metal breakdown is taxed on gross and flagged', () => {
  const v = lineVat({ totalMinor: 120000n, metalValueMinor: null, vatClass: 'gold_margin', rateBp: 2000 });
  assert.equal(v.basis, 'gross_no_metal_value');
  assert.equal(v.vatMinor, 20000n);
});

test('exempt and full classes', () => {
  const ex = lineVat({ totalMinor: 650000n, vatClass: 'exempt', rateBp: 2000 });
  assert.equal(ex.vatMinor, 0n);
  assert.equal(ex.rateBp, 0);
  const full = lineVat({ totalMinor: 360000n, vatClass: 'full', rateBp: 2000 });
  // 3 600.00 × 20/120 = 600.00
  assert.equal(full.vatMinor, 60000n);
  assert.equal(full.netMinor, 300000n);
});

test('summary groups by rate; partial returns are cumulative and exact', () => {
  const s = summarize([
    { rateBp: 2000, taxableGrossMinor: 120000n, vatMinor: 20000n },
    { rateBp: 0, taxableGrossMinor: 0n, vatMinor: 0n },
    { rateBp: 2000, taxableGrossMinor: 360000n, vatMinor: 60000n },
  ]);
  assert.equal(s.vatMinor, 80000n);
  assert.deepEqual(s.byRate.map((b) => [b.rateBp, b.vatMinor]), [[0, 0n], [2000, 80000n]]);
  // 3 units, VAT 100.00: returning 1 + 1 + 1 must give back exactly 100.00
  const parts = [returnedVat(10000n, 3, 0, 1), returnedVat(10000n, 3, 1, 1), returnedVat(10000n, 3, 2, 1)];
  assert.equal(parts.reduce((a, b) => a + b, 0n), 10000n);
});
