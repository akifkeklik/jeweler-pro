/**
 * Purchase commands and figures: validates a new-purchase payload (product
 * and fine-gold lines, up-front payments) and derives the open figures and
 * payment status of a purchase after returns and refunds. Money is BigInt kuruş.
 */
const { parseDecimal, toDisplayNumber, DecimalError } = require('../../domain/decimal');
const { SCALE, LIMITS } = require('../../domain/precision');
const { resolvePurity, fineWeightMg, assertMetal } = require('../../domain/metals');
const { badRequest, parseNumericId } = require('../finance/core');

const PAYMENT_METHODS = ['nakit', 'kredi kartı', 'havale'];
const money = (minor) => toDisplayNumber(minor, SCALE.MONEY);

function wrap(error) {
  if (error instanceof DecimalError) return badRequest(error.message, error.code);
  return error;
}

function parsePayments(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw badRequest('payments bir dizi olmalıdır');
  return raw.map((p) => {
    if (!p || !PAYMENT_METHODS.includes(p.method)) throw badRequest('Geçersiz ödeme yöntemi');
    return { method: p.method, amountMinor: parseDecimal(p.amount, SCALE.MONEY, { field: 'Ödeme tutarı', allowZero: false, max: LIMITS.MAX_MONEY_MINOR }) };
  });
}

function parsePurchaseCommand(payload) {
  if (!payload || typeof payload !== 'object') throw badRequest('Geçerli bir alış bilgisi gönderilmelidir');
  const supplierId = parseNumericId(payload.supplierId, 'tedarikçi');
  if (!Array.isArray(payload.lines) || !payload.lines.length) throw badRequest('Alışta en az bir satır olmalıdır');
  if (payload.lines.length > 100) throw badRequest('Bir alışta en fazla 100 satır olabilir');
  const lines = payload.lines.map((raw, index) => {
    const lineId = index + 1;
    if (raw?.metal) {
      const metal = assertMetal(raw.metal);
      const purity = resolvePurity(raw);
      const weightMg = parseDecimal(raw.weightGrams, SCALE.WEIGHT, { field: 'Gramaj', allowZero: false, max: LIMITS.MAX_WEIGHT_MG });
      const totalMinor = parseDecimal(raw.totalCost, SCALE.MONEY, { field: 'Alış tutarı', max: LIMITS.MAX_MONEY_MINOR });
      return { lineId, itemType: 'metal', metal, purity, weightMg, fineMg: fineWeightMg(weightMg, purity), totalMinor };
    }
    const productId = parseNumericId(raw?.productId, 'ürün');
    const quantity = Number(raw?.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > LIMITS.MAX_QUANTITY) throw badRequest('Alış miktarı pozitif bir tam sayı olmalıdır');
    const unitCostMinor = parseDecimal(raw?.unitCost, SCALE.MONEY, { field: 'Birim maliyet', max: LIMITS.MAX_MONEY_MINOR });
    return { lineId, itemType: 'product', productId, quantity, unitCostMinor, totalMinor: unitCostMinor * BigInt(quantity) };
  });
  return {
    supplierId,
    lines,
    payments: parsePayments(payload.payments),
    invoiceNo: typeof payload.invoiceNo === 'string' ? payload.invoiceNo.trim().slice(0, 60) : undefined,
    notes: typeof payload.notes === 'string' ? payload.notes.trim().slice(0, 1000) : undefined,
  };
}

function paymentStatus(total, paid) {
  if (paid > total) return 'overpaid';
  if (paid <= 0n) return total === 0n ? 'paid' : 'unpaid';
  return paid >= total ? 'paid' : 'partial';
}

/**
 * Open figures of a purchase after returns and refunds:
 *   net   = total − returned (goods returns + price adjustments)
 *   paid  = payments − refunds received from the supplier
 *   due   = net − paid (> 0: we still owe; < 0: the supplier owes us)
 */
function openFigures(purchase) {
  const net = BigInt(purchase.totalMinor) - BigInt(purchase.returnedMinor || 0);
  const paid = BigInt(purchase.paidMinor || 0) - BigInt(purchase.refundedMinor || 0);
  return { net, paid, due: net - paid };
}

module.exports = {
  PAYMENT_METHODS, money, wrap, parsePayments, parsePurchaseCommand, paymentStatus, openFigures,
};
