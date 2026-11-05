const test = require('node:test');
const assert = require('node:assert/strict');
const { createSalesService } = require('../services/salesService');

function buildService(overrides = {}) {
  const state = { stock: 4, saved: [], saleStatus: 'completed' };
  const Product = {
    findOneAndUpdate: async (filter, update) => {
      if (state.stock < filter.stock.$gte) return null;
      state.stock += update.$inc.stock;
      return { _id: 12, price: 150, costPrice: 90, stock: state.stock };
    },
    exists: async () => true,
    updateOne: async (_filter, update) => {
      state.stock += update.$inc.stock;
      return { acknowledged: true, matchedCount: 1 };
    },
  };
  const Customer = { findById: async () => ({ _id: 7 }) };
  class Sale {
    constructor(data) { Object.assign(this, data); this._id = 12345678; }
    async save() { state.saved.push(this); }
  }
  if (overrides.save) Sale.prototype.save = overrides.save;
  Object.assign(Product, overrides.Product || {});
  Object.assign(Customer, overrides.Customer || {});
  Object.assign(Sale, overrides.Sale || {});
  Sale.findById = async () => ({ _id: 12345678, productId: 12, quantity: 2, status: state.saleStatus });
  Sale.findOneAndUpdate = async (_filter, update) => {
    state.saleStatus = update.$set.status || state.saleStatus;
    return { _id: 12345678, ...update.$set };
  };
  Sale.updateOne = async (_filter, update) => {
    state.saleStatus = update.$set.status;
    return { acknowledged: true };
  };
  return { service: createSalesService({ Sale, Product, Customer }), state };
}

test('creates a sale using the server price and deducts stock', async () => {
  const { service, state } = buildService();
  const sale = await service.createSale({ customerId: 7, productId: 12, quantity: 2 });
  assert.equal(state.stock, 2);
  assert.equal(sale.totalPrice, 300);
  assert.equal(sale.unitCostAtSale, 90);
  assert.equal(state.saved.length, 1);
});

test('rejects a sale when stock is insufficient', async () => {
  const { service, state } = buildService();
  await assert.rejects(
    service.createSale({ customerId: 7, productId: 12, quantity: 5 }),
    (error) => error.statusCode === 409
  );
  assert.equal(state.stock, 4);
  assert.equal(state.saved.length, 0);
});

test('restores stock if persisting a sale fails', async () => {
  const { service, state } = buildService({ save: async () => { throw new Error('database write failed'); } });
  await assert.rejects(service.createSale({ customerId: 7, productId: 12, quantity: 2 }));
  assert.equal(state.stock, 4);
});

test('does not trust a client supplied total price', async () => {
  const { service } = buildService();
  const sale = await service.createSale({ customerId: 7, productId: 12, quantity: 1, totalPrice: 1 });
  assert.equal(sale.totalPrice, 150);
});

test('cancelling a sale restores its stock', async () => {
  const { service, state } = buildService();
  const result = await service.cancelSale(12345678);
  assert.equal(result.status, 'cancelled');
  assert.equal(state.stock, 6);
});

test('rejects non-positive and fractional quantities', async () => {
  const { service } = buildService();
  await assert.rejects(service.createSale({ customerId: 7, productId: 12, quantity: 0 }), (e) => e.statusCode === 400);
  await assert.rejects(service.createSale({ customerId: 7, productId: 12, quantity: 1.5 }), (e) => e.statusCode === 400);
});
