/**
 * Sale command parsing and pricing: validates a create-sale payload (multi-line
 * or the legacy single-product shape) and prices lines against products and
 * resolved metal quotes. Money is BigInt kuruş throughout.
 */
const {
  parseDecimal, toDisplayNumber, format, DecimalError,
} = require('../../domain/decimal');
const { SCALE, LIMITS } = require('../../domain/precision');
const { priceGramUnit, priceLine, computeDiscount, allocateProportionally } = require('../../domain/pricing');
const { snapshotOf } = require('../finance/metalPricing');
const { METALS } = require('../../domain/metals');
const { badRequest, conflict, unprocessable } = require('../finance/core');

const SALE_PAYMENT_METHODS = ['nakit', 'kredi kartı', 'havale'];
const REFUND_METHODS = [...SALE_PAYMENT_METHODS, 'cari'];
const MAX_LINES = 100;

const money = (minor) => toDisplayNumber(minor, SCALE.MONEY);

function asDomainError(error) {
  if (error instanceof DecimalError) return badRequest(error.message, error.code);
  return error;
}

/* ------------------------------------------------------------------ input */

function parseAmount(value, field) {
  return parseDecimal(value, SCALE.MONEY, { field, allowZero: false, max: LIMITS.MAX_MONEY_MINOR });
}

function parseDiscount(raw, field) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw badRequest(`${field} { type, value } biçiminde olmalıdır`);
  const type = raw.type || 'amount';
  if (!['percent', 'amount'].includes(type)) throw badRequest(`${field} türü percent veya amount olmalıdır`);
  if (raw.value === undefined || raw.value === null || raw.value === '') return null;
  // Validate eagerly (value format); the amount itself is computed against the line.
  parseDecimal(raw.value, type === 'percent' ? SCALE.PERCENT : SCALE.MONEY, { field, max: type === 'percent' ? 10000n : LIMITS.MAX_MONEY_MINOR });
  return { type, value: raw.value };
}

/**
 * manualPrices: { [metal code]: TRY per fine gram }, e.g. { XAU: '3200', XAG: '41.5' }.
 * Each gram-priced line uses the manual price of ITS product's metal; a key
 * that is not a known metal is an error (a misspelt or wrong key would
 * otherwise be ignored silently and the sale refused for a missing quote).
 * The value itself is validated when the price is resolved (metalPricing).
 */
function parseManualPrices(raw) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('manualPrices { XAU, XAG } biçiminde olmalıdır', 'INVALID_MANUAL_PRICE');
  const out = {};
  for (const [metal, value] of Object.entries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(METALS, metal)) {
      throw badRequest(`Geçersiz maden kodu: ${metal} (XAU veya XAG olmalıdır)`, 'INVALID_METAL');
    }
    if (value !== undefined && value !== null && value !== '') out[metal] = value;
  }
  return out;
}

/**
 * Normalises a create-sale payload (new multi-line shape or the legacy
 * single-product shape) into a validated command.
 */
function parseSaleCommand(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw badRequest('Geçerli bir satış bilgisi gönderilmelidir');
  }
  const customerId = Number(payload.customerId);
  if (!Number.isSafeInteger(customerId) || customerId <= 0) throw badRequest('Geçerli bir müşteri seçilmelidir');

  if (payload.date !== undefined && payload.date !== null && payload.date !== '') {
    // The posting date is always the server time; an invalid client value is still an error.
    if (Number.isNaN(new Date(payload.date).getTime())) throw badRequest('Geçersiz satış tarihi');
  }

  const legacy = !Array.isArray(payload.lines);
  let rawLines;
  if (legacy) {
    rawLines = [{ productId: payload.productId, quantity: payload.quantity ?? 1 }];
  } else {
    rawLines = payload.lines;
    if (!rawLines.length) throw badRequest('Satışta en az bir ürün satırı olmalıdır');
    if (rawLines.length > MAX_LINES) throw badRequest(`Bir satışta en fazla ${MAX_LINES} satır olabilir`);
  }

  const lines = rawLines.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw badRequest(`${index + 1}. satır geçersiz`);
    const productId = Number(raw.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) throw badRequest('Geçerli bir ürün seçilmelidir');
    const quantity = Number(raw.quantity ?? 1);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > LIMITS.MAX_QUANTITY) {
      throw badRequest('Satış miktarı pozitif bir tam sayı olmalıdır');
    }
    const weightMg = raw.weightGrams === undefined || raw.weightGrams === null || raw.weightGrams === ''
      ? null
      : parseDecimal(raw.weightGrams, SCALE.WEIGHT, { field: 'Gramaj', allowZero: false, max: LIMITS.MAX_WEIGHT_MG });
    return { lineId: index + 1, productId, quantity, weightMg, discount: parseDiscount(raw.discount, 'Satır indirimi') };
  });

  // payments:
  //   explicit array           → exactly those payments (may be partial or empty)
  //   absent + paymentMethod   → the whole sale paid with that method ('cari' = on account)
  //   absent, legacy shape     → paid in full in cash (historic contract)
  //   absent, multi-line shape → on account (unpaid)
  let payments;
  let fullPaymentMethod = null;
  if (Array.isArray(payload.payments)) {
    payments = payload.payments.map((p) => {
      if (!p || !SALE_PAYMENT_METHODS.includes(p.method)) throw badRequest('Geçersiz ödeme yöntemi');
      // `pos` (card only): { providerId, installments, terminalId, authCode } for commission accounting.
      return { method: p.method, amountMinor: parseAmount(p.amount, 'Ödeme tutarı'), pos: p.method === 'kredi kartı' ? p.pos : undefined };
    });
    if (payments.length > 10) throw badRequest('Bir satışta en fazla 10 ödeme satırı olabilir');
  } else if (payload.payments !== undefined && payload.payments !== null) {
    throw badRequest('payments bir dizi olmalıdır');
  } else {
    const method = payload.paymentMethod ?? (legacy ? 'nakit' : 'cari');
    if (method === 'cari') {
      payments = [];
    } else if (SALE_PAYMENT_METHODS.includes(method)) {
      payments = 'full';
      fullPaymentMethod = method;
    } else {
      throw badRequest('Geçersiz ödeme yöntemi');
    }
  }

  return {
    customerId,
    lines,
    discount: parseDiscount(payload.discount, 'Satış indirimi'),
    payments,
    fullPaymentMethod,
    fullPaymentPos: fullPaymentMethod === 'kredi kartı' ? payload.pos : undefined,
    manualPrices: parseManualPrices(payload.manualPrices),
    notes: typeof payload.notes === 'string' ? payload.notes.trim().slice(0, 1000) : undefined,
  };
}

/* ---------------------------------------------------------------- pricing */

function storedMoney(value, field) {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw unprocessable(`${field} geçerli değil`, 'PRICE_NOT_DEFINED');
  }
  return parseDecimal(Number(value), SCALE.MONEY, { field, round: true });
}

/** Prices one line against a (session-loaded) product. */
function priceSaleLine(product, line, prices) {
  const base = {
    lineId: line.lineId,
    productId: product._id,
    productName: product.name,
    pricingMode: product.pricingMode || 'fixed',
    quantity: line.quantity,
  };
  if (base.pricingMode === 'gram') {
    if (!product.metal || !product.purity) {
      throw unprocessable(`${product.name}: gram fiyatlı ürün için maden ve saflık tanımlanmalıdır`, 'PRODUCT_PRICING_INCOMPLETE');
    }
    const weightMg = line.weightMg ?? (product.weight
      ? parseDecimal(product.weight, SCALE.WEIGHT, { field: 'Ürün gramajı', round: true })
      : null);
    if (!weightMg || weightMg <= 0n) throw unprocessable(`${product.name}: gramaj tanımlı değil`, 'PRODUCT_PRICING_INCOMPLETE');
    const quote = prices[product.metal];
    if (!quote) throw conflict('Gram fiyatı çözümlenemedi', 'MARKET_PRICE_UNAVAILABLE');
    const laborType = product.laborType || 'none';
    const laborScale = laborType === 'milyem' ? SCALE.MILYEM : SCALE.MONEY;
    const laborValue = laborType === 'none' ? 0n : parseDecimal(product.laborValue || 0, laborScale, { field: 'İşçilik', round: true });
    const unit = priceGramUnit({ weightMg, purity: BigInt(product.purity), pricePerGram: quote.pricePerGram, laborType, laborValue });
    const amounts = priceLine({ unitPriceMinor: unit.unitPriceMinor, quantity: line.quantity, discount: line.discount });
    return {
      ...base,
      metal: product.metal,
      purity: product.purity,
      weightMgPerUnit: weightMg,
      fineMg: unit.fineMg * BigInt(line.quantity),
      laborType,
      laborValue: format(laborValue, laborScale),
      price: snapshotOf(quote),
      unitPriceMinor: unit.unitPriceMinor,
      metalValueMinor: unit.metalValueMinor,
      laborMinor: unit.laborMinor,
      ...amounts,
    };
  }
  const unitPriceMinor = storedMoney(product.price, 'Ürünün satış fiyatı');
  return { ...base, unitPriceMinor, ...priceLine({ unitPriceMinor, quantity: line.quantity, discount: line.discount }) };
}

/** Applies the sale-level discount and computes totals. */
function totalsOf(pricedLines, saleDiscount) {
  const lineTotals = pricedLines.map((l) => l.totalMinor);
  const subtotal = lineTotals.reduce((s, v) => s + v, 0n);
  const saleDiscountMinor = computeDiscount(subtotal, saleDiscount);
  const parts = allocateProportionally(saleDiscountMinor, lineTotals);
  const lines = pricedLines.map((l, i) => ({
    ...l,
    lineDiscountMinor: l.discountMinor,
    saleDiscountMinor: parts[i],
    totalMinor: l.totalMinor - parts[i],
  }));
  const total = lines.reduce((s, l) => s + l.totalMinor, 0n);
  const grossDiscount = lines.reduce((s, l) => s + l.lineDiscountMinor + l.saleDiscountMinor, 0n);
  return { lines, subtotalMinor: lines.reduce((s, l) => s + l.grossMinor, 0n), discountMinor: grossDiscount, totalMinor: total };
}

module.exports = {
  SALE_PAYMENT_METHODS,
  REFUND_METHODS,
  money,
  asDomainError,
  parseAmount,
  parseDiscount,
  parseManualPrices,
  parseSaleCommand,
  storedMoney,
  priceSaleLine,
  totalsOf,
};
