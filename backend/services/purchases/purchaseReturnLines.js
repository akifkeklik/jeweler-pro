/**
 * Purchase return / price adjustment commands: validates the payload and
 * computes per-line returned and remaining value (cumulative proportions, so
 * returning everything clears each line exactly).
 */
const { parseDecimal, roundDiv } = require('../../domain/decimal');
const { SCALE, LIMITS, ROUNDING_MODE } = require('../../domain/precision');
const { badRequest } = require('../finance/core');
const { parsePayments } = require('./purchaseCommand');

const RETURN_KINDS = ['goods', 'price_adjustment'];

function lineReturnOf(purchase, lineId) {
  let entry = purchase.lineReturns.find((r) => r.lineId === lineId);
  if (!entry) {
    purchase.lineReturns.push({ lineId, quantity: 0, weightMg: 0, fineMg: 0, amountMinor: 0, adjustedMinor: 0 });
    entry = purchase.lineReturns[purchase.lineReturns.length - 1];
  }
  return entry;
}

/** Supplier value still open on a line: total − goods credited − price adjustments. */
function remainingLineValue(line, returned) {
  return BigInt(line.totalMinor) - BigInt(returned?.amountMinor || 0) - BigInt(returned?.adjustedMinor || 0);
}

function share(total, part, whole) {
  if (part >= whole) return BigInt(total);
  return roundDiv(BigInt(total) * BigInt(part), BigInt(whole), ROUNDING_MODE);
}

function parseReturnCommand(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw badRequest('Geçerli bir iade bilgisi gönderilmelidir');
  const kind = payload.kind || 'goods';
  if (!RETURN_KINDS.includes(kind)) throw badRequest('İade türü goods veya price_adjustment olmalıdır', 'INVALID_RETURN_KIND');
  const reason = typeof payload.reason === 'string' ? payload.reason.trim().slice(0, 300) : '';
  if (!reason) throw badRequest('İade gerekçesi girilmelidir', 'REASON_REQUIRED');
  if (!Array.isArray(payload.lines) || !payload.lines.length) throw badRequest('İade edilecek satırlar belirtilmelidir');
  const seen = new Set();
  const lines = payload.lines.map((raw) => {
    const lineId = Number(raw?.lineId);
    if (!Number.isSafeInteger(lineId) || lineId <= 0) throw badRequest('İade satırı geçersiz', 'PURCHASE_LINE_NOT_FOUND');
    if (seen.has(lineId)) throw badRequest('Aynı satır bir iadede yalnızca bir kez yer alabilir', 'DUPLICATE_RETURN_LINE');
    seen.add(lineId);
    if (kind === 'price_adjustment') {
      return { lineId, amountMinor: parseDecimal(raw.amount, SCALE.MONEY, { field: 'Fiyat farkı', allowZero: false, max: LIMITS.MAX_MONEY_MINOR }) };
    }
    const out = { lineId };
    if (raw.quantity !== undefined && raw.quantity !== null && raw.quantity !== '') {
      const quantity = Number(raw.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) throw badRequest('İade miktarı pozitif bir tam sayı olmalıdır', 'INVALID_QUANTITY');
      out.quantity = quantity;
    }
    if (raw.weightGrams !== undefined && raw.weightGrams !== null && raw.weightGrams !== '') {
      out.weightMg = parseDecimal(raw.weightGrams, SCALE.WEIGHT, { field: 'İade gramajı', allowZero: false, max: LIMITS.MAX_WEIGHT_MG });
    }
    return out;
  });
  return {
    kind,
    reason,
    lines,
    refunds: parsePayments(payload.refunds),
    creditNoteNo: typeof payload.creditNoteNo === 'string' ? payload.creditNoteNo.trim().slice(0, 60) : undefined,
  };
}

/**
 * Purchase return (iade alışı) against the original purchase lines, or a
 * supplier price adjustment (alacak dekontu) when the goods cannot or need
 * not go back.
 *
 * goods:
 *   - quantity (pieces) / weight (metal) ≤ purchased − already returned
 *   - the goods must physically be available (stock − transfer reservations);
 *     otherwise 409 INSUFFICIENT_STOCK_FOR_RETURN with the alternative
 *   - supplier credit = the line's remaining value × returned share (exact,
 *     the last unit takes the remainder: a full return credits the line exactly)
 *   - inventory leaves at its weighted-average cost; the difference between
 *     that cost and the supplier credit is booked to purchase_return_variance
 *   Dr ap:{supplier} credit | Cr inventory:{branch} cost | ± purchase_return_variance
 * price_adjustment:
 *   Dr ap:{supplier} | Cr purchase_price_adjustment   (no stock movement)
 * refunds (optional): money the supplier pays back, up to its credit on
 *   this purchase: Dr cash/bank | Cr ap:{supplier}
 */

module.exports = { RETURN_KINDS, lineReturnOf, remainingLineValue, share, parseReturnCommand };
