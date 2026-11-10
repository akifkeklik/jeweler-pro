const test = require('node:test');
const assert = require('node:assert/strict');
const { getProvider, registerProvider, buildFiscalDocument } = require('../services/fiscal');

test('the default provider never claims a legal document was issued', async () => {
  const provider = getProvider('manual');
  assert.equal((await provider.issue({})).status, 'not_issued');
  assert.throws(() => getProvider('unknown-integrator'), /FISCAL_PROVIDER/);
  assert.throws(() => registerProvider({ name: 'broken' }), TypeError);
});

test('the fiscal document carries seller, buyer, KDV lines and totals in kuruş', () => {
  const doc = buildFiscalDocument({
    sale: {
      _id: 7, date: new Date('2026-11-10'), totalMinor: 150000, discountMinor: 0, vatMinor: 25000,
      lines: [{ productName: 'Kolye', quantity: 1, totalMinor: 150000, vat: { vatClass: 'full', rateBp: 2000, vatMinor: 25000, taxableGrossMinor: 150000 } }],
    },
    profile: { companyName: 'Test A.Ş.', taxOffice: 'Fatih', taxNumber: '1234567890', address: 'İstanbul' },
    customer: { name: 'Ayşe', identityType: 'tckn', identityNumber: '10000000146' },
  });
  assert.equal(doc.seller.taxNumber, '1234567890');
  assert.equal(doc.buyer.identityNumber, '10000000146');
  assert.equal(doc.buyer.display, '10*******46');
  assert.equal(doc.lines[0].vatMinor, 25000);
  assert.equal(doc.totals.vatMinor, 25000);
});
