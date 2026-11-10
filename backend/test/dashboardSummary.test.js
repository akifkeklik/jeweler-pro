/**
 * GET /api/dashboard/summary — the all-time totals must equal the exact
 * reference computation (routes/reports.js saleNet, per sale, in kuruş with
 * HALF_UP proportional cost on partial returns) for every sale
 * shape: legacy (with / without unit cost), multi-line, partially and fully
 * returned lines, unknown line cost, cancelled sales, other branches and
 * other businesses.
 */
const { inspect } = require('../testSupport/tenantInspection');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'dashboard-summary-secret-with-more-than-thirty-two-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const Sale = inspect(require('../models/Sale'));
const { signToken } = require('../middleware/auth');
const { hashPassword } = require('../utils/passwords');
const { saleNet } = require('../routes/reports');
const { fromCents } = require('../utils/financial');
const { createHarness, mustOk, uid } = require('../testSupport/financeHarness');

const A = 'Merkez';
const B = 'Şube 2';
const harness = createHarness({ app, signToken, User, hashPassword });

let nextId = 9100000 + Math.floor(Math.random() * 100000) * 10;
const line = (lineId, { qty, total, cost, returned = 0 }) => ({
  lineId, productId: 100000 + lineId, productName: `Ürün ${lineId}`, pricingMode: 'fixed', quantity: qty,
  unitPriceMinor: Math.floor(total / qty), grossMinor: total, totalMinor: total, costMinor: cost, returnedQuantity: returned,
});
function sale(businessId, branch, customerId, extra) {
  nextId += 1;
  return { _id: nextId, businessId, branch, customerId, productId: 100001, quantity: 1, totalPrice: 1, status: 'completed', date: new Date(), ...extra };
}

/** The pre-aggregation implementation, verbatim: the oracle. */
function reference(sales) {
  let totalRevenue = 0;
  let totalCost = 0;
  let costComplete = true;
  let totalQuantity = 0;
  const customerIds = new Set();
  for (const s of sales) {
    const { revenue, cost } = saleNet(s);
    totalRevenue += revenue;
    if (cost === null) costComplete = false;
    else totalCost += cost;
    totalQuantity += Array.isArray(s.lines) && s.lines.length
      ? s.lines.reduce((sum, l) => sum + l.quantity - (l.returnedQuantity || 0), 0)
      : (s.quantity || 0);
    if (s.customerId !== undefined && s.customerId !== null) customerIds.add(String(s.customerId));
  }
  return {
    totalRevenue: fromCents(totalRevenue),
    totalProfit: costComplete ? fromCents(totalRevenue - totalCost) : null,
    profitDataComplete: costComplete,
    totalQuantity,
    totalCustomers: customerIds.size,
  };
}

describe('Dashboard summary aggregation (real MongoDB, HTTP)', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  before(async () => {
    await mongoose.connect(uri);
    await User.init();
    await harness.start();
  });
  after(async () => {
    await harness.stop();
    await mongoose.disconnect();
  });

  async function seed({ unknownCost }) {
    const t = await harness.tenant({ branches: [A, B] });
    const biz = t.businessId;
    const docs = [
      // Exact, no returns: 2 lines.
      sale(biz, A, 7001, { totalMinor: 150000, returnedMinor: 0, lines: [line(1, { qty: 2, total: 100000, cost: 60000 }), line(2, { qty: 1, total: 50000, cost: 20000 })] }),
      // Partial return with an odd half-unit: cost 1001 × 1/2 = 500.5 → 501 (HALF_UP).
      sale(biz, A, 7002, { status: 'partially_returned', totalMinor: 2000, returnedMinor: 1000, lines: [line(1, { qty: 2, total: 2000, cost: 1001, returned: 1 })] }),
      // Partial return, 3 units, 1 kept: 1000 × 1/3 = 333.33 → 333.
      sale(biz, A, 7002, { status: 'partially_returned', totalMinor: 3000, returnedMinor: 2000, lines: [line(1, { qty: 3, total: 3000, cost: 1000, returned: 2 })] }),
      // Fully returned line.
      sale(biz, B, 7003, { status: 'returned', totalMinor: 4000, returnedMinor: 4000, lines: [line(1, { qty: 1, total: 4000, cost: 2500, returned: 1 })] }),
      // Legacy sale with cost / without cost.
      sale(biz, B, 7004, { totalPrice: 123.45, quantity: 3, unitCostAtSale: 20.1 }),
      sale(biz, A, '7005', { totalPrice: 99.99, quantity: 1, unitCostAtSale: unknownCost ? null : 50 }),
      // Cancelled: excluded.
      sale(biz, A, 7006, { status: 'cancelled', totalMinor: 999999, returnedMinor: 0, lines: [line(1, { qty: 1, total: 999999, cost: 1 })] }),
    ];
    if (unknownCost) {
      docs.push(sale(biz, B, 7007, { totalMinor: 5000, returnedMinor: 0, lines: [line(1, { qty: 1, total: 5000, cost: null })] }));
    }
    await Sale.collection.insertMany(docs);
    // Noise in another business: must never be counted.
    await Sale.collection.insertOne(sale(`biz_other_${uid()}`, A, 7001, { totalMinor: 777777, returnedMinor: 0, lines: [line(1, { qty: 1, total: 777777, cost: 1 })] }));
    return { t, docs };
  }

  for (const unknownCost of [false, true]) {
    it(`equals the exact per-sale reference (${unknownCost ? 'with' : 'without'} unknown costs), per branch scope`, async () => {
      const { t, docs } = await seed({ unknownCost });
      const live = (d) => d.status !== 'cancelled';
      const adminView = await mustOk(await t.admin.get('/api/dashboard/summary'), 'admin');
      assert.deepEqual(adminView, reference(docs.filter(live)));
      const staffB = await mustOk(await t.branch[B].staff.get('/api/dashboard/summary'), 'staff B');
      assert.deepEqual(staffB, reference(docs.filter((d) => live(d) && d.branch === B)));
      if (!unknownCost) {
        // Hand check: revenue 1500 + 10 + 10 + 0 + 123.45 + 99.99 = 1743.44 ;
        // cost 800 + 5.01 + 3.33 + 0 + 60.30 + 50 = 918.64 ; profit 824.80
        assert.equal(adminView.totalRevenue, 1743.44);
        assert.equal(adminView.totalProfit, 824.8);
        assert.equal(adminView.totalQuantity, 3 + 1 + 1 + 0 + 3 + 1);
        assert.equal(adminView.totalCustomers, 5);
      } else {
        assert.equal(adminView.totalProfit, null);
        assert.equal(adminView.profitDataComplete, false);
      }
    });
  }
});
