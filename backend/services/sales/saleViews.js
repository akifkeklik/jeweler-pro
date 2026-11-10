/**
 * Response views of sales: line and quote DTOs, the financial view of a
 * stored sale, payment status and branch visibility.
 */
const { toDisplayNumber } = require('../../domain/decimal');
const { money } = require('./saleCommand');

/* ------------------------------------------------------------------- DTOs */

function lineDto(line) {
  return {
    lineId: line.lineId,
    productId: line.productId,
    productName: line.productName,
    pricingMode: line.pricingMode,
    quantity: line.quantity,
    returnedQuantity: line.returnedQuantity || 0,
    metal: line.metal,
    purity: line.purity,
    weightGramsPerUnit: line.weightMgPerUnit !== undefined && line.weightMgPerUnit !== null ? toDisplayNumber(line.weightMgPerUnit, 3) : undefined,
    fineGrams: line.fineMg !== undefined && line.fineMg !== null ? toDisplayNumber(line.fineMg, 3) : undefined,
    laborType: line.laborType,
    laborValue: line.laborValue,
    price: line.price,
    unitPrice: money(line.unitPriceMinor),
    metalValue: line.metalValueMinor !== undefined && line.metalValueMinor !== null ? money(line.metalValueMinor) : undefined,
    labor: line.laborMinor !== undefined && line.laborMinor !== null ? money(line.laborMinor) : undefined,
    gross: money(line.grossMinor),
    lineDiscount: money(line.lineDiscountMinor ?? line.discountMinor ?? 0n),
    saleDiscount: money(line.saleDiscountMinor ?? 0n),
    total: money(line.totalMinor),
    vat: line.vat ? {
      vatClass: line.vat.vatClass,
      rate: line.vat.rateBp / 100,
      basis: line.vat.basis,
      taxableGross: money(line.vat.taxableGrossMinor),
      vat: money(line.vat.vatMinor),
    } : undefined,
  };
}

function quoteDto(totals, payments) {
  const paid = payments.reduce((s, p) => s + p.amountMinor, 0n);
  return {
    lines: totals.lines.map(lineDto),
    subtotal: money(totals.subtotalMinor),
    discount: money(totals.discountMinor),
    total: money(totals.totalMinor),
    paid: money(paid),
    balanceDue: money(totals.totalMinor - paid),
  };
}

/** Financial view of a stored sale (legacy sales derive it from legacy fields). */
function financialView(sale) {
  const s = sale.toObject ? sale.toObject() : sale;
  if (s.totalMinor === undefined || s.totalMinor === null) {
    return { journaled: false, total: s.totalPrice, paid: s.status === 'cancelled' ? 0 : s.totalPrice, balanceDue: 0, returned: 0, paymentStatus: s.status === 'cancelled' ? 'refunded' : 'paid' };
  }
  return {
    journaled: Boolean(s.journalEntryId) || s.totalMinor === 0,
    total: money(s.totalMinor),
    subtotal: money(s.subtotalMinor ?? s.totalMinor),
    discount: money(s.discountMinor ?? 0),
    paid: money(s.paidMinor ?? 0),
    returned: money(s.returnedMinor ?? 0),
    balanceDue: money(s.balanceDueMinor ?? 0),
    paymentStatus: s.paymentStatus,
    // KDV contained in the total (null = VAT was not enabled for this sale).
    vat: s.vatMinor === undefined || s.vatMinor === null ? null : money(s.vatMinor),
    identified: Boolean(s.identification),
  };
}

function paymentStatusOf(netMinor, paidMinor) {
  if (netMinor <= 0n && paidMinor <= 0n) return 'paid';
  if (paidMinor <= 0n) return 'unpaid';
  if (paidMinor >= netMinor) return 'paid';
  return 'partial';
}

function primaryMethod(payments) {
  if (!payments.length) return 'cari';
  return [...payments].sort((a, b) => (b.amountMinor > a.amountMinor ? 1 : b.amountMinor < a.amountMinor ? -1 : 0))[0].method;
}

/** Non-admins only see sales of their own branch (legacy sales without a branch stay visible). */
function visibleTo(ctx, sale) {
  return ctx.isAdmin || !sale.branch || sale.branch === ctx.branch;
}

module.exports = { lineDto, quoteDto, financialView, paymentStatusOf, primaryMethod, visibleTo };
