const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Sale = require('../models/Sale');
const { createSalesService } = require('../services/salesService');

const uri = process.env.MONGO_URI;

test('MongoDB transaction keeps sale, stock and cancellation consistent', { skip: !uri }, async (t) => {
  await mongoose.connect(uri);
  const customer = await Customer.create({ name: 'CI integration customer' });
  const product = await Product.create({
    name: 'CI integration product',
    price: 250,
    costPrice: 100,
    stock: 2,
  });
  const service = createSalesService({ Sale, Product, Customer });

  t.after(async () => {
    await Sale.deleteMany({ productId: product._id });
    await Product.deleteOne({ _id: product._id });
    await Customer.deleteOne({ _id: customer._id });
    await mongoose.disconnect();
  });

  const sale = await service.createSale({
    customerId: customer._id,
    productId: product._id,
    quantity: 1,
    totalPrice: 1,
  });

  assert.equal(sale.totalPrice, 250);
  assert.equal(sale.unitPriceAtSale, 250);
  assert.equal(sale.unitCostAtSale, 100);
  assert.equal((await Product.findById(product._id)).stock, 1);

  const cancelled = await service.cancelSale(sale._id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal((await Product.findById(product._id)).stock, 2);

  await assert.rejects(service.cancelSale(sale._id), (error) => error.statusCode === 409);
  assert.equal((await Product.findById(product._id)).stock, 2);
});

test('concurrent sales cannot oversell the final stock unit', { skip: !uri }, async (t) => {
  await mongoose.connect(uri);
  const customer = await Customer.create({ name: 'CI concurrency customer' });
  const product = await Product.create({
    name: 'CI concurrency product',
    price: 90,
    costPrice: 40,
    stock: 1,
  });
  const service = createSalesService({ Sale, Product, Customer });

  t.after(async () => {
    await Sale.deleteMany({ productId: product._id });
    await Product.deleteOne({ _id: product._id });
    await Customer.deleteOne({ _id: customer._id });
    await mongoose.disconnect();
  });

  const outcomes = await Promise.allSettled([
    service.createSale({ customerId: customer._id, productId: product._id, quantity: 1 }),
    service.createSale({ customerId: customer._id, productId: product._id, quantity: 1 }),
  ]);

  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.statusCode, 409);
  assert.equal((await Product.findById(product._id)).stock, 0);
  assert.equal(await Sale.countDocuments({ productId: product._id, status: 'completed' }), 1);
});
