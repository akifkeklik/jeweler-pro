/**
 * Sales service behaviour (real MongoDB replica set via `npm test`).
 *
 * These tests previously ran against hand-written model fakes. The sales
 * service now drives the inventory engine and the double-entry ledger, which
 * cannot be faked faithfully, so every original test runs against the real
 * database with the same assertions. Faults are injected through the
 * service's own dependencies (audit store, Sale.save).
 */
const { inspect } = require('../testSupport/tenantInspection');
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Product = inspect(require('../models/Product'));
const Customer = inspect(require('../models/Customer'));
const Sale = inspect(require('../models/Sale'));
const AuditLog = require('../models/AuditLog');
const StockMovement = inspect(require('../models/StockMovement'));
const LedgerEntry = inspect(require('../models/LedgerEntry'));
const { createSalesService } = require('../services/salesService');
const { DEFAULT_BRANCH, DEFAULT_BUSINESS_ID } = require('../config/tenancy');

const uri = process.env.MONGO_URI;
const skip = !uri && 'MONGO_URI not set — run `npm test`';

test.before(async () => {
  if (!uri) return;
  await mongoose.connect(uri);
  await Promise.all([Product.init(), Customer.init(), Sale.init(), AuditLog.init(), StockMovement.init(), LedgerEntry.init()]);
});
test.after(async () => {
  if (uri) await mongoose.disconnect();
});

async function fixture({ price = 150, costPrice = 90, stock = 4 } = {}) {
  const customer = await Customer.create({ businessId: DEFAULT_BUSINESS_ID, name: 'Sales service customer' });
  // Stock is owned by the branch that sells it (the service's system context: default branch).
  const product = await Product.create({ businessId: DEFAULT_BUSINESS_ID, name: 'Sales service product', price, costPrice, stock, branch: DEFAULT_BRANCH });
  return { customer, product };
}

const stockOf = async (product) => (await Product.findById(product._id).lean()).stock;

test('creates a sale using the server price and deducts stock atomically', { skip }, async () => {
  const { customer, product } = await fixture();
  const service = createSalesService();
  const sale = await service.createSale({ customerId: customer._id, productId: product._id, quantity: 2 });
  assert.equal(await stockOf(product), 2);
  assert.equal(sale.totalPrice, 300);
  assert.equal(sale.unitCostAtSale, 90);
  assert.equal(await Sale.countDocuments({ productId: product._id }), 1);
});

test('rejects a sale when stock is insufficient', { skip }, async () => {
  const { customer, product } = await fixture();
  const service = createSalesService();
  await assert.rejects(service.createSale({ customerId: customer._id, productId: product._id, quantity: 5 }), (error) => error.statusCode === 409);
  assert.equal(await stockOf(product), 4);
  assert.equal(await Sale.countDocuments({ productId: product._id }), 0);
});

test('rejects sales with invalid customer or product references', { skip }, async () => {
  const { customer, product } = await fixture();
  const service = createSalesService();
  await assert.rejects(
    service.createSale({ customerId: 99999999, productId: product._id, quantity: 1 }),
    (error) => error.statusCode === 404,
  );
  await assert.rejects(
    service.createSale({ customerId: customer._id, productId: 999999, quantity: 1 }),
    (error) => error.statusCode === 404,
  );
  assert.equal(await stockOf(product), 4);
});

test('transaction rollback restores stock if persisting a sale fails', { skip }, async () => {
  const { customer, product } = await fixture();
  const service = createSalesService();
  const originalSave = Sale.prototype.save;
  Sale.prototype.save = async function failingSave() { throw new Error('database write failed'); };
  try {
    await assert.rejects(service.createSale({ customerId: customer._id, productId: product._id, quantity: 2 }));
  } finally {
    Sale.prototype.save = originalSave;
  }
  assert.equal(await stockOf(product), 4);
  assert.equal(await StockMovement.countDocuments({ productId: product._id }), 0, 'stock movement rolled back too');
  assert.equal(await LedgerEntry.countDocuments({ 'lines.account': `ar:${customer._id}` }), 0, 'journal rolled back too');
});

test('does not trust a client supplied total price', { skip }, async () => {
  const { customer, product } = await fixture();
  const service = createSalesService();
  const sale = await service.createSale({ customerId: customer._id, productId: product._id, quantity: 1, totalPrice: 1 });
  assert.equal(sale.totalPrice, 150);
});

test('rounds unit and total prices using decimal-safe money arithmetic', { skip }, async () => {
  const { customer, product } = await fixture({ price: 0.1, costPrice: 0.03, stock: 3 });
  const service = createSalesService();
  const sale = await service.createSale({ customerId: customer._id, productId: product._id, quantity: 3 });
  assert.equal(sale.unitPriceAtSale, 0.1);
  assert.equal(sale.totalPrice, 0.3);
  assert.equal(sale.totalMinor, 30, 'exact kuruş, not 0.30000000000000004');
  assert.equal(sale.unitCostAtSale, 0.03);
});

test('cancelling a sale restores its stock atomically', { skip }, async () => {
  const { customer, product } = await fixture();
  const service = createSalesService();
  const sale = await service.createSale({ customerId: customer._id, productId: product._id, quantity: 2 });
  assert.equal(await stockOf(product), 2);
  const result = await service.cancelSale(sale._id);
  assert.equal(result.status, 'cancelled');
  assert.equal(await stockOf(product), 4);
});

test('rejects non-positive and fractional quantities', { skip }, async () => {
  const { customer, product } = await fixture();
  const service = createSalesService();
  await assert.rejects(service.createSale({ customerId: customer._id, productId: product._id, quantity: 0 }), (e) => e.statusCode === 400);
  await assert.rejects(service.createSale({ customerId: customer._id, productId: product._id, quantity: 1.5 }), (e) => e.statusCode === 400);
});

test('writes sale audit records inside the transaction', { skip }, async () => {
  const { customer, product } = await fixture();
  const entries = [];
  const recordingAuditLog = {
    create: async ([entry], options) => {
      assert.ok(options.session, 'audit write must join the sale transaction');
      entries.push(entry);
      return AuditLog.create([entry], options);
    },
  };
  const service = createSalesService({ AuditLog: recordingAuditLog });
  await service.createSale(
    { customerId: customer._id, productId: product._id, quantity: 1 },
    { actorUserId: '507f1f77bcf86cd799439011', correlationId: 'corr-sale-create' },
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, 'sale.created');
  assert.equal(entries[0].resourceType, 'Sale');
  assert.equal(entries[0].correlationId, 'corr-sale-create');
  assert.equal(entries[0].after.totalPrice, 150);
});

test('rolls back the sale when audit persistence fails', { skip }, async () => {
  const { customer, product } = await fixture();
  const service = createSalesService({
    AuditLog: { create: async () => { throw new Error('audit write failed'); } },
  });
  await assert.rejects(service.createSale(
    { customerId: customer._id, productId: product._id, quantity: 1 },
    { actorUserId: '507f1f77bcf86cd799439011', correlationId: 'corr-sale-fail' },
  ));
  assert.equal(await stockOf(product), 4);
  assert.equal(await Sale.countDocuments({ productId: product._id }), 0);
});

test('rolls back sale updates when audit persistence fails', { skip }, async () => {
  const { customer, product } = await fixture();
  // A sale recorded by the previous (pre-ledger) system: paymentMethod is still editable.
  const legacy = await Sale.create({ businessId: DEFAULT_BUSINESS_ID, customerId: customer._id, productId: product._id, quantity: 1, totalPrice: 150, paymentMethod: 'nakit' });
  const service = createSalesService({
    AuditLog: { create: async () => { throw new Error('audit update failed'); } },
  });
  await assert.rejects(service.updateSale(
    legacy._id,
    { paymentMethod: 'havale' },
    { actorUserId: '507f1f77bcf86cd799439011', correlationId: 'corr-update-fail' },
  ));
  const stored = await Sale.findById(legacy._id).lean();
  assert.equal(stored.status, 'completed');
  assert.equal(stored.paymentMethod, 'nakit');
});
