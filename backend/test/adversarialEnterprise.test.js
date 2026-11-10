const { inspect } = require('../testSupport/tenantInspection');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Category = inspect(require('../models/Category'));
const Material = inspect(require('../models/Material'));
const Product = inspect(require('../models/Product'));
const Customer = inspect(require('../models/Customer'));
const Sale = inspect(require('../models/Sale'));
const AuditLog = require('../models/AuditLog');
const Price = require('../models/Price');
const { createSalesService } = require('../services/salesService');
const { DEFAULT_BRANCH, DEFAULT_BUSINESS_ID } = require('../config/tenancy');
const workerInstance = require('../services/marketDataWorker');

describe('Adversarial Enterprise QA & Database Integrity Tests', () => {
  let replSet;
  let salesService;

  before(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const uri = replSet.getUri('adversarial_qa');
    await mongoose.connect(uri);
    // Unique indexes must exist before the duplicate-key assertions run
    // (previously a race with the background index build made test 2 flaky).
    await Promise.all([Category.init(), Material.init(), Product.init(), Customer.init(), Sale.init(), AuditLog.init(), Price.init()]);

    salesService = createSalesService({
      AuditLog,
      startSession: () => mongoose.startSession(),
    });
  });

  after(async () => {
    workerInstance.stop();
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    if (replSet) {
      await replSet.stop();
    }
  });

  it('1. Category: validates required fields, generates numeric _id and handles uniqueness', async () => {
    const cat = new Category({ businessId: DEFAULT_BUSINESS_ID, name: '22 Ayar Bilezik' });
    await cat.save();

    assert.ok(cat._id, 'Numeric ID must be allocated');
    assert.strictEqual(typeof cat._id, 'number');
    assert.strictEqual(cat.name, '22 Ayar Bilezik');

    const loaded = await Category.findById(cat._id);
    assert.ok(loaded);
    assert.strictEqual(loaded.name, '22 Ayar Bilezik');
  });

  it('2. Product: enforces non-negative price/stock and barcode uniqueness', async () => {
    const p1 = new Product({
      businessId: DEFAULT_BUSINESS_ID,
      name: 'Burma Bilezik 20gr',
      price: 65000,
      costPrice: 61000,
      weight: 20,
      stock: 5,
      barcode: '869000111222',
    });
    await p1.save();
    assert.ok(p1._id);

    // Attempt duplicate barcode
    const p2 = new Product({
      businessId: DEFAULT_BUSINESS_ID,
      name: 'Başka Bilezik',
      price: 45000,
      stock: 2,
      barcode: '869000111222', // duplicate
    });

    await assert.rejects(async () => {
      await p2.save();
    }, /E11000 duplicate key error/);
  });

  it('3. Customer: creates record and manages ledger fields', async () => {
    const cust = new Customer({
      businessId: DEFAULT_BUSINESS_ID,
      name: 'Hasan Kuyumculuk',
      customerType: 'kurumsal',
      phone: '05551234567',
      email: 'hasan@kuyumcu.com',
    });
    await cust.save();
    assert.ok(cust._id);
    assert.strictEqual(cust.customerType, 'kurumsal');
  });

  it('4. Sales: atomic transaction deducts stock and records audit trail', async () => {
    const cust = new Customer({ businessId: DEFAULT_BUSINESS_ID, name: 'Ayşe Hanım', phone: '05321112233' });
    await cust.save();

    const prod = new Product({
      businessId: DEFAULT_BUSINESS_ID,
      name: 'Tektaş Yüzük',
      price: 15000,
      costPrice: 12000,
      stock: 3,
      branch: DEFAULT_BRANCH, // stock is owned by the branch that sells it (system context)
      barcode: '869000333444',
    });
    await prod.save();

    const fakeUserId = new mongoose.Types.ObjectId();
    const auditCtx = {
      actorUserId: fakeUserId,
      correlationId: 'req-adv-101',
    };

    const sale = await salesService.createSale(
      {
        customerId: cust._id,
        productId: prod._id,
        quantity: 2,
        paymentMethod: 'kredi kartı',
      },
      auditCtx
    );

    assert.ok(sale._id);
    assert.strictEqual(sale.totalPrice, 30000);
    assert.strictEqual(sale.quantity, 2);

    // Stock should be deducted from 3 to 1
    const updatedProd = await Product.findById(prod._id);
    assert.strictEqual(updatedProd.stock, 1);

    // Audit log must exist
    const logs = await AuditLog.find({ resourceId: sale._id });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].action, 'sale.created');
    assert.strictEqual(logs[0].resourceType, 'Sale');
  });

  it('5. Sales: cancelling restores stock and writes cancel audit record', async () => {
    const cust = await Customer.findOne();
    const prod = new Product({
      businessId: DEFAULT_BUSINESS_ID,
      name: 'Altın Kolye',
      price: 8000,
      stock: 2,
      branch: DEFAULT_BRANCH, // stock is owned by the branch that sells it (system context)
      barcode: '869000555666',
    });
    await prod.save();

    const auditCtx = { actorUserId: new mongoose.Types.ObjectId(), correlationId: 'req-adv-102' };
    const sale = await salesService.createSale(
      { customerId: cust._id, productId: prod._id, quantity: 2 },
      auditCtx
    );

    let prodAfterSale = await Product.findById(prod._id);
    assert.strictEqual(prodAfterSale.stock, 0);

    // Cancel sale
    const cancelled = await salesService.cancelSale(sale._id, auditCtx);
    assert.strictEqual(cancelled.status, 'cancelled');

    // Stock restored
    const prodRestored = await Product.findById(prod._id);
    assert.strictEqual(prodRestored.stock, 2);

    const cancelLogs = await AuditLog.find({ resourceId: sale._id, action: 'sale.cancelled' });
    assert.strictEqual(cancelLogs.length, 1);
  });

  it('6. MarketDataWorker: saves quotes on change, prevents duplicate records on static quotes', async () => {
    const mockQuotes = [
      {
        symbol: 'HAS_ALTIN',
        type: 'Has Altın (24K)',
        buy: 6500.0,
        sell: 6510.0,
        source: 'test_provider',
        currency: 'TRY',
      },
      {
        symbol: 'USD/TRY',
        type: 'Amerikan Doları',
        buy: 50.0,
        sell: 50.1,
        source: 'test_provider',
        currency: 'TRY',
      },
    ];

    const initialCount = await Price.countDocuments();

    // First persist
    await workerInstance.persistQuotesToDatabase(mockQuotes);
    const countAfterFirst = await Price.countDocuments();
    assert.strictEqual(countAfterFirst, initialCount + 2);

    // Second persist with identical quotes within 5 minutes -> must NOT create duplicates
    await workerInstance.persistQuotesToDatabase(mockQuotes);
    const countAfterSecond = await Price.countDocuments();
    assert.strictEqual(countAfterSecond, countAfterFirst, 'Duplicate records must be suppressed');

    // Third persist with changed price -> must persist new price record
    const changedQuotes = [
      {
        symbol: 'HAS_ALTIN',
        type: 'Has Altın (24K)',
        buy: 6520.0, // changed
        sell: 6530.0,
        source: 'test_provider',
        currency: 'TRY',
      },
    ];
    await workerInstance.persistQuotesToDatabase(changedQuotes);
    const countAfterChanged = await Price.countDocuments();
    assert.strictEqual(countAfterChanged, countAfterFirst + 1, 'Changed price must be recorded');
  });

  it('7. CashTransaction & Cari: updates customer balance with decimal safety', async () => {
    const CashTransaction = inspect(require('../models/CashTransaction'));
    const cust = new Customer({
      businessId: DEFAULT_BUSINESS_ID,
      name: 'Karat Mücevherat',
      customerType: 'kurumsal',
      balanceTry: -10000, // owes 10,000 TL
      balanceGold: -5.5,   // owes 5.5 gr Has
    });
    await cust.save();

    // Customer makes a payment of 6,000 TL and 2.5 gr Has
    const tx = new CashTransaction({
      businessId: DEFAULT_BUSINESS_ID,
      customerId: cust._id,
      type: 'tahsilat',
      amountTry: 6000,
      amountGoldGrams: 2.5,
      description: 'Cari borç kapama tahsilatı',
    });
    await tx.save();

    cust.balanceTry += 6000;
    cust.balanceGold += 2.5;
    await cust.save();

    const updated = await Customer.findById(cust._id);
    assert.strictEqual(updated.balanceTry, -4000);
    assert.strictEqual(updated.balanceGold, -3.0);
  });

  it('8. DailyClosing: verifies Z-Report calculation and cash reconciliation', async () => {
    const DailyClosing = inspect(require('../models/DailyClosing'));
    const todayStr = '2026-11-08';

    const closing = new DailyClosing({
      businessId: DEFAULT_BUSINESS_ID,
      date: todayStr,
      totalSalesTry: 75000,
      totalSalesCount: 4,
      totalCollectionsTry: 20000,
      totalPaymentsTry: 5000,
      closingCashCalculated: 90000,
      closingCashActual: 89500, // 500 TL cash difference / shortage
      cashDifference: -500,
      isClosed: true,
      notes: '500 TL kasa eksiği bulundu',
    });
    await closing.save();

    const record = await DailyClosing.findOne({ date: todayStr });
    assert.ok(record);
    assert.strictEqual(record.isClosed, true);
    assert.strictEqual(record.cashDifference, -500);
    assert.strictEqual(record.closingCashCalculated, 90000);
  });
});
