/**
 * Multi-tenant isolation.
 *
 * 1. The tenant guard turns an unscoped query on business data into a loud
 *    error instead of a silent cross-tenant read/write.
 * 2. End to end (real MongoDB, HTTP): a second business can neither list,
 *    read, change nor delete the first business's records, and cannot sell
 *    the first business's products to the first business's customers.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'tenant-isolation-secret-with-more-than-32-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const AccountBalance = require('../models/AccountBalance');
const { TenantScopeError, filterHasTenant } = require('../models/plugins/tenantGuard');
const { signToken } = require('../middleware/auth');
const { hashPassword } = require('../utils/passwords');
const { createHarness, mustOk, uid } = require('../testSupport/financeHarness');

describe('tenant guard (pure)', () => {
  it('recognises tenant filters, including $eq, $in and $and', () => {
    assert.equal(filterHasTenant({ businessId: 'a' }), true);
    assert.equal(filterHasTenant({ businessId: { $eq: 'a' } }), true);
    assert.equal(filterHasTenant({ businessId: { $in: ['a', 'b'] } }), true);
    assert.equal(filterHasTenant({ $and: [{ x: 1 }, { businessId: 'a' }] }), true);
  });

  it('rejects missing, empty or operator-only tenant filters', () => {
    assert.equal(filterHasTenant({}), false);
    assert.equal(filterHasTenant({ _id: 5 }), false);
    assert.equal(filterHasTenant({ businessId: '' }), false);
    assert.equal(filterHasTenant({ businessId: { $ne: 'a' } }), false);
    assert.equal(filterHasTenant({ businessId: { $exists: true } }), false);
    assert.equal(filterHasTenant({ businessId: { $in: [] } }), false);
    assert.equal(filterHasTenant({ $or: [{ businessId: 'a' }, { name: 'x' }] }), false);
  });

  it('accepts composite ids only for models that declare them', () => {
    assert.equal(filterHasTenant({ _id: 'biz|cash|TRY' }), false);
    assert.equal(filterHasTenant({ _id: 'biz|cash|TRY' }, { compositeId: true }), true);
    assert.equal(filterHasTenant({ _id: 'no-separator' }, { compositeId: true }), false);
  });

  it('throws before the query reaches MongoDB; a bypass must carry a reason', async () => {
    // No connection is needed: the guard runs in pre-middleware.
    await assert.rejects(Product.find({}).exec(), TenantScopeError);
    await assert.rejects(Customer.findOne({ _id: 1 }).exec(), TenantScopeError);
    await assert.rejects(Product.updateMany({}, { $set: { name: 'x' } }).exec(), TenantScopeError);
    await assert.rejects(Product.aggregate([{ $group: { _id: null } }]).exec(), TenantScopeError);
    await assert.rejects(Product.find({}).setOptions({ skipTenantGuard: true }).exec(), TenantScopeError);
    await assert.rejects(AccountBalance.findOne({ account: 'cash' }).exec(), TenantScopeError);
  });

  it('requires businessId on new documents', async () => {
    const error = new Customer({ name: 'No tenant' }).validateSync();
    assert.ok(error?.errors?.businessId, 'businessId is required');
  });
});

describe('cross-tenant isolation (real MongoDB, HTTP)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  const harness = createHarness({ app, signToken, User, hashPassword });
  let a;
  let b;
  let customerA;
  let productA;
  let supplierA;

  before(async () => {
    await mongoose.connect(uri);
    await Promise.all([User.init(), Product.init(), Customer.init()]);
    await harness.start();
    [a, b] = await Promise.all([harness.tenant(), harness.tenant()]);
    customerA = await mustOk(await a.admin.post('/api/customers', { name: `Müşteri ${uid()}` }), 'customer');
    productA = await mustOk(await a.admin.post('/api/products', { name: `Yüzük ${uid()}`, price: '1000.00', costPrice: '500.00', stock: 3, branch: a.branches[0] }), 'product');
    supplierA = await mustOk(await a.admin.post('/api/suppliers', { name: `Tedarikçi ${uid()}` }), 'supplier');
  });

  after(async () => {
    await harness.stop();
    await mongoose.disconnect();
  });

  it('lists of another business never contain these records', async () => {
    for (const [path, id] of [['/api/customers', customerA._id], ['/api/products', productA._id], ['/api/suppliers', supplierA._id]]) {
      const res = await b.admin.get(path);
      assert.equal(res.status, 200, `${path}: ${JSON.stringify(res.body)}`);
      const items = Array.isArray(res.body) ? res.body : (res.body.items || res.body.data || []);
      assert.ok(!items.some((item) => item._id === id), `${path} leaked a record of another business`);
    }
  });

  it('read, update and delete by id behave exactly like a missing record', async () => {
    for (const path of [`/api/customers/${customerA._id}`, `/api/products/${productA._id}`, `/api/suppliers/${supplierA._id}`]) {
      assert.equal((await b.admin.get(path)).status, 404, `GET ${path}`);
      assert.equal((await b.admin.put(path, { name: 'hijacked' })).status, 404, `PUT ${path}`);
      assert.equal((await b.admin.del(path)).status, 404, `DELETE ${path}`);
    }
    const still = await a.admin.get(`/api/customers/${customerA._id}`);
    assert.equal(still.status, 200);
    assert.notEqual(still.body.name, 'hijacked');
  });

  it("cannot sell another business's product or bill another business's customer", async () => {
    const res = await b.admin.post('/api/sales', {
      customerId: customerA._id,
      lines: [{ productId: productA._id, quantity: 1 }],
      payments: [],
    });
    assert.ok([400, 404, 409, 422].includes(res.status), `cross-tenant sale must fail: ${res.status} ${JSON.stringify(res.body)}`);
    const stock = await Product.findOne({ _id: productA._id, businessId: a.businessId }).lean();
    assert.equal(stock.stock, 3, 'stock of the other business is untouched');
  });

  it('explicitly targeting another business is refused', async () => {
    const res = await b.admin.get('/api/customers', { 'X-Business-Id': a.businessId });
    assert.equal(res.status, 403);
  });
});
