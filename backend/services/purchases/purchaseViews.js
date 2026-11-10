/** API view of a purchase: totals, payments, returns and per-line remaining value. */
const { toDisplayNumber } = require('../../domain/decimal');
const { remainingLineValue } = require('./purchaseReturnLines');
const { money, openFigures } = require('./purchaseCommand');

function purchaseDto(purchase) {
  const p = purchase.toObject ? purchase.toObject() : purchase;
  const { net, paid: effectivePaid, due } = openFigures(p);
  const returnedByLine = new Map((p.lineReturns || []).map((r) => [r.lineId, r]));
  return {
    _id: p._id,
    supplierId: p.supplierId,
    supplierName: p.supplierId && typeof p.supplierId === 'object' ? p.supplierId.name : undefined,
    branch: p.branch,
    invoiceNo: p.invoiceNo,
    date: p.date,
    status: p.status,
    paymentStatus: p.paymentStatus,
    total: money(p.totalMinor),
    paid: money(p.paidMinor || 0),
    returned: money(p.returnedMinor || 0),
    refunded: money(p.refundedMinor || 0),
    net: money(net),
    netPaid: money(effectivePaid),
    remaining: money(due > 0n ? due : 0n),
    supplierCredit: money(due < 0n ? -due : 0n),
    returnStatus: p.returnStatus || 'none',
    lines: (p.lines || []).map((l) => ({
      lineId: l.lineId,
      itemType: l.itemType,
      productId: l.productId,
      productName: l.productName,
      quantity: l.quantity,
      metal: l.metal,
      purity: l.purity,
      weightGrams: l.weightMg ? toDisplayNumber(l.weightMg, 3) : undefined,
      fineGrams: l.fineMg ? toDisplayNumber(l.fineMg, 3) : undefined,
      unitCost: l.unitCostMinor !== undefined ? money(l.unitCostMinor) : undefined,
      total: money(l.totalMinor),
      returnedQuantity: returnedByLine.get(l.lineId)?.quantity || 0,
      returnedWeightGrams: toDisplayNumber(BigInt(returnedByLine.get(l.lineId)?.weightMg || 0), 3),
      returnedAmount: money(returnedByLine.get(l.lineId)?.amountMinor || 0),
      adjustedAmount: money(returnedByLine.get(l.lineId)?.adjustedMinor || 0),
      remainingValue: money(remainingLineValue(l, returnedByLine.get(l.lineId))),
    })),
    payments: (p.payments || []).map((pay) => ({ kind: pay.kind || 'payment', method: pay.method, amount: money(pay.amountMinor), at: pay.at })),
    returns: (p.returns || []).map((r) => ({
      returnId: r.returnId,
      kind: r.kind,
      amount: money(r.amountMinor),
      cost: money(r.costMinor || 0),
      variance: money(r.varianceMinor || 0),
      refund: money(r.refundMinor || 0),
      reason: r.reason,
      creditNoteNo: r.creditNoteNo,
      at: r.at,
      lines: (r.lines || []).map((l) => ({
        lineId: l.lineId,
        quantity: l.quantity,
        weightGrams: toDisplayNumber(BigInt(l.weightMg || 0), 3),
        fineGrams: toDisplayNumber(BigInt(l.fineMg || 0), 3),
        amount: money(l.amountMinor),
        cost: l.costMinor === null || l.costMinor === undefined ? null : money(l.costMinor),
      })),
    })),
    notes: p.notes,
  };
}

module.exports = { purchaseDto };
