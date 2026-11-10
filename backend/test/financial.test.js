const { inspect } = require('../testSupport/tenantInspection');
const test = require('node:test');
const assert = require('node:assert/strict');
const { toCents, fromCents, multiplyMoney } = require('../utils/financial');
const Product = inspect(require('../models/Product'));
const Sale = inspect(require('../models/Sale'));

test('uses decimal-safe cent arithmetic for money', () => {
  assert.equal(toCents(1.005), 101);
  assert.equal(toCents('0.10'), 10);
  assert.equal(multiplyMoney(0.1, 3), 0.3);
  assert.equal(fromCents(12345), 123.45);
});

test('rejects non-finite, negative and unsafe financial inputs', () => {
  assert.throws(() => toCents(Infinity));
  assert.throws(() => toCents(-1));
  assert.throws(() => toCents('NaN'));
  assert.throws(() => multiplyMoney(10, 1.5));
});

test('Mongoose financial fields reject non-finite values', () => {
  const product = new Product({ name: 'invalid', price: Infinity, stock: 0 });
  const sale = new Sale({
    customerId: 1,
    productId: 1,
    totalPrice: NaN,
  });
  assert.ok(product.validateSync());
  assert.ok(sale.validateSync());
});

test('product barcode uniqueness remains enforced by the schema', () => {
  // Unique per business (tenant): a global unique index would leak across tenants.
  const index = Product.schema.indexes().find(([fields]) => fields.businessId === 1 && fields.barcode === 1);
  assert.ok(index, 'compound { businessId, barcode } index exists');
  assert.equal(index[1].unique, true);
  assert.deepEqual(index[1].partialFilterExpression, { barcode: { $type: 'string' } });
});
