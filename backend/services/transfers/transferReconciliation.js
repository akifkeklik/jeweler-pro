/**
 * Transfer sub-ledger reconciliation (part of GET /api/ledger/reconciliation).
 */
const Product = require('../../models/Product');
const MetalStock = require('../../models/MetalStock');
const StockTransfer = require('../../models/StockTransfer');
const { toDisplayNumber } = require('../../domain/decimal');
const ledger = require('../finance/ledgerService');
const { settled } = require('./transferLines');

const { ACCOUNTS } = ledger;

/**
 * Transfer sub-ledger checks:
 *  - goods-in-transit account == Σ outstanding known cost of open transfers
 *  - every line conserves quantity, weight, fine content and cost
 *  - reserved stock == Σ approved (not yet dispatched) transfer lines
 */
async function reconcile(businessId) {
  const discrepancies = [];
  const transfers = await StockTransfer.find({ businessId, status: { $in: ['approved', 'in_transit', 'partially_received', 'received'] } }).lean();
  let expectedTransit = 0n;
  const reservedByProduct = new Map();
  const reservedByPool = new Map();
  for (const t of transfers) {
    for (const line of t.lines) {
      if (t.status === 'approved') {
        if (line.itemType === 'product') reservedByProduct.set(line.productId, (reservedByProduct.get(line.productId) || 0) + line.quantity);
        else {
          const key = MetalStock.idFor(businessId, t.sourceBranch, line.metal, line.purity);
          const r = reservedByPool.get(key) || { weightMg: 0, fineMg: 0 };
          reservedByPool.set(key, { weightMg: r.weightMg + line.weightMg, fineMg: r.fineMg + line.fineMg });
        }
        continue;
      }
      const d = line.dispatched || {};
      for (const field of ['quantity', 'weightMg', 'fineMg']) {
        if (settled(line, field) > (d[field] || 0)) {
          discrepancies.push({ check: 'transfer_line_overrun', transferId: t._id, lineId: line.lineId, field, dispatched: d[field] || 0, settled: settled(line, field) });
        }
      }
      if (d.costMinor !== null && d.costMinor !== undefined) {
        const settledCost = ['received', 'returned', 'writtenOff'].reduce((s, k) => s + BigInt(line[k]?.costMinor || 0), 0n);
        const outstanding = BigInt(d.costMinor) - settledCost;
        if (outstanding < 0n) discrepancies.push({ check: 'transfer_cost_overrun', transferId: t._id, lineId: line.lineId });
        if (t.status === 'received' && outstanding !== 0n) {
          discrepancies.push({ check: 'transfer_cost_not_cleared', transferId: t._id, lineId: line.lineId, outstanding: Number(outstanding) });
        }
        expectedTransit += outstanding;
      }
    }
  }
  const transitBalance = await ledger.balanceOf(businessId, ACCOUNTS.inventoryInTransit, 'TRY');
  if (transitBalance !== expectedTransit) {
    discrepancies.push({ check: 'transit_balance', ledger: Number(transitBalance), transfers: Number(expectedTransit) });
  }

  const reservedProducts = await Product.find({ businessId, reservedStock: { $gt: 0 } }).select('_id name reservedStock').lean();
  const seen = new Set();
  for (const p of reservedProducts) {
    seen.add(p._id);
    if ((reservedByProduct.get(p._id) || 0) !== p.reservedStock) {
      discrepancies.push({ check: 'reservation', productId: p._id, name: p.name, stored: p.reservedStock, transfers: reservedByProduct.get(p._id) || 0 });
    }
  }
  for (const [productId, quantity] of reservedByProduct) {
    if (!seen.has(productId)) discrepancies.push({ check: 'reservation', productId, stored: 0, transfers: quantity });
  }
  const pools = await MetalStock.find({ businessId, $or: [{ reservedWeightMg: { $gt: 0 } }, { reservedFineMg: { $gt: 0 } }] }).lean();
  const seenPools = new Set();
  for (const pool of pools) {
    seenPools.add(pool._id);
    const expected = reservedByPool.get(pool._id) || { weightMg: 0, fineMg: 0 };
    if (expected.weightMg !== (pool.reservedWeightMg || 0) || expected.fineMg !== (pool.reservedFineMg || 0)) {
      discrepancies.push({ check: 'metal_reservation', pool: pool._id, stored: { weightMg: pool.reservedWeightMg, fineMg: pool.reservedFineMg }, transfers: expected });
    }
  }
  for (const [pool, expected] of reservedByPool) {
    if (!seenPools.has(pool)) discrepancies.push({ check: 'metal_reservation', pool, stored: null, transfers: expected });
  }

  return {
    ok: discrepancies.length === 0,
    checkedAt: new Date().toISOString(),
    transfersChecked: transfers.length,
    inTransitCostTry: toDisplayNumber(expectedTransit, 2),
    discrepancies,
  };
}

module.exports = { reconcile };
