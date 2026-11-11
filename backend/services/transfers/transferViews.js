/**
 * API view of a stock transfer: per-line dispatched, received, returned,
 * written-off and outstanding amounts, and the event history.
 */
const { toDisplayNumber } = require('../../domain/decimal');
const { outstandingOf } = require('./transferLines');

const grams = (mg) => (mg === null || mg === undefined ? null : toDisplayNumber(BigInt(mg), 3));
const tl = (minor) => (minor === null || minor === undefined ? null : toDisplayNumber(BigInt(minor), 2));

function quantitiesDto(q) {
  if (!q) return { quantity: 0, weightGrams: 0, fineGrams: 0, cost: 0 };
  return { quantity: q.quantity || 0, weightGrams: grams(q.weightMg || 0), fineGrams: grams(q.fineMg || 0), cost: tl(q.costMinor ?? null) };
}

function transferDto(transfer) {
  const t = transfer.toObject ? transfer.toObject() : transfer;
  const dispatched = !['draft', 'approved', 'cancelled', 'rejected'].includes(t.status);
  return {
    _id: t._id,
    status: t.status,
    sourceBranch: t.sourceBranch,
    destinationBranch: t.destinationBranch,
    notes: t.notes,
    createdAt: t.createdAt,
    createdBy: t.createdBy,
    approvedAt: t.approvedAt,
    approvedBy: t.approvedBy,
    dispatchedAt: t.dispatchedAt,
    completedAt: t.completedAt,
    cancelledAt: t.cancelledAt,
    rejectedAt: t.rejectedAt,
    lines: (t.lines || []).map((l) => {
      const out = dispatched ? outstandingOf(l) : null;
      return {
        lineId: l.lineId,
        itemType: l.itemType,
        productId: l.productId,
        productName: l.productName,
        destinationProductId: l.destinationProductId,
        quantity: l.quantity,
        metal: l.metal,
        purity: l.purity,
        weightGrams: l.itemType === 'metal' ? grams(l.weightMg) : undefined,
        fineGrams: l.itemType === 'metal' ? grams(l.fineMg) : undefined,
        dispatched: dispatched ? quantitiesDto(l.dispatched) : null,
        received: quantitiesDto(l.received),
        returned: quantitiesDto(l.returned),
        writtenOff: quantitiesDto(l.writtenOff),
        outstanding: out ? { quantity: out.quantity, weightGrams: grams(out.weightMg), fineGrams: grams(out.fineMg) } : null,
      };
    }),
    events: (t.events || []).map((e) => ({
      action: e.action, fromStatus: e.fromStatus, toStatus: e.toStatus, at: e.at, by: e.by, note: e.note, details: e.details,
    })),
  };
}

module.exports = { transferDto, quantitiesDto };
