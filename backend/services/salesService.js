/**
 * Sales lifecycle: Sale → stock decrease → customer receivable → collection.
 *
 * One transaction per command; every effect (stock movements, journal
 * entries, customer balance, sale document, idempotency record, audit
 * record) commits or rolls back together. Business rules:
 * backend/BUSINESS_RULES.md → "Sales".
 */
const mongoose = require('mongoose');
const SaleModel = require('../models/Sale');
const ProductModel = require('../models/Product');
const CustomerModel = require('../models/Customer');
const { recordAudit } = require('../utils/audit');
const {
  parseDecimal, toSafeInteger, toDisplayNumber, format, roundDiv, DecimalError,
} = require('../domain/decimal');
const { SCALE, LIMITS } = require('../domain/precision');
const { priceGramUnit, priceLine, computeDiscount, allocateProportionally } = require('../domain/pricing');
const { ROUNDING_MODE } = require('../domain/precision');
const ledger = require('./finance/ledgerService');
const inventory = require('./finance/inventoryService');
const pos = require('./posService');
const { resolveMetalPrices, snapshotOf } = require('./finance/metalPricing');
const { METALS } = require('../domain/metals');
const { assertBranch } = require('./finance/branchDirectory');
const { resolveVatClass, lineVat, returnedVat } = require('../domain/vat');
const { loadProfile } = require('./businessProfileService');
const {
  DomainError, badRequest, notFound, conflict, unprocessable, systemContext, runInTransaction, parseNumericId,
} = require('./finance/core');

const { ACCOUNTS, paymentAccount, debit, credit } = ledger;
const SALE_PAYMENT_METHODS = ['nakit', 'kredi kartı', 'havale'];
const REFUND_METHODS = [...SALE_PAYMENT_METHODS, 'cari'];
const MAX_LINES = 100;

function httpError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

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

/* ---------------------------------------------------------------- service */

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

function createSalesService({
  Sale = SaleModel,
  Product = ProductModel,
  Customer = CustomerModel,
  AuditLog,
  startSession = () => mongoose.startSession(),
  quoteSource,
} = {}) {
  const tx = (work) => runInTransaction(work, { startSession });

  function contextFor(ctx, auditContext) {
    if (ctx) return ctx;
    return systemContext({ userId: auditContext?.actorUserId || null, correlationId: auditContext?.correlationId || 'system' });
  }

  async function audit(session, ctx, action, sale, extra) {
    if (!AuditLog || !ctx.userId) return;
    await recordAudit({
      AuditLog,
      session,
      actorUserId: ctx.userId,
      action,
      resourceType: 'Sale',
      resourceId: sale._id,
      correlationId: ctx.correlationId,
      ...extra,
    });
  }

  /** Reads the products outside the transaction to find the metal prices needed. */
  async function resolvePrices(ctx, command) {
    const ids = [...new Set(command.lines.map((l) => l.productId))];
    const products = await Product.find({ _id: { $in: ids }, businessId: ctx.businessId, isArchived: { $ne: true } })
      .select('_id pricingMode metal branch').lean();
    const metals = products.filter((p) => p.pricingMode === 'gram' && p.metal).map((p) => p.metal);
    const modes = new Map(products.map((p) => [p._id, p.pricingMode || 'fixed']));
    if (!metals.length) return { prices: {}, modes, products };
    const prices = await resolveMetalPrices(metals, 'sell', { manualPrices: command.manualPrices, ...(quoteSource ? { quoteSource } : {}) });
    return { prices, modes, products };
  }

  /**
   * Prices every line inside `session`. Lines of the same product share ONE
   * document (inventory.productLoader), so the stock movements of a later
   * line see the stock and cost pool left by the earlier ones.
   */
  async function priceInSession(session, ctx, command, prices, modes, { checkStock = false } = {}) {
    const products = inventory.productLoader(session, ctx);
    const priced = [];
    for (const line of command.lines) {
      const product = await products.load(line.productId);
      if (modes && modes.has(product._id) && modes.get(product._id) !== (product.pricingMode || 'fixed')) {
        throw conflict('Ürünün fiyatlandırma türü değişti; lütfen tekrar deneyin', 'PRODUCT_CHANGED');
      }
      priced.push({ product, line: priceSaleLine(product, line, prices) });
    }
    if (checkStock) assertAggregateStock(priced);
    return priced;
  }

  /**
   * The units requested for one product across ALL its lines must be free
   * (stock − transfer reservations). Checked up front so a cart such as
   * 2 + 2 of an item with 3 on hand fails with the total, not with a
   * confusing per-line remainder.
   */
  function assertAggregateStock(priced) {
    const wanted = new Map();
    for (const { product, line } of priced) {
      const entry = wanted.get(product._id) || { product, quantity: 0 };
      entry.quantity += line.quantity;
      wanted.set(product._id, entry);
    }
    for (const { product, quantity } of wanted.values()) {
      const stock = product.stock || 0;
      const reserved = inventory.reservedOf(product);
      if (stock - reserved < quantity) {
        const detail = reserved > 0 ? `, transfer için ayrılan ${reserved}` : '';
        throw conflict(`Yetersiz stok: ${product.name} (mevcut ${stock}${detail}, istenen ${quantity})`, 'INSUFFICIENT_STOCK', {
          productId: product._id, stock, reserved, requested: quantity,
        });
      }
    }
  }

  /** POST /api/sales/quote — exact server-side preview; nothing is stored. */
  async function quoteSale(payload, ctxIn) {
    const ctx = contextFor(ctxIn);
    try {
      const command = parseSaleCommand(payload);
      const { prices, modes } = await resolvePrices(ctx, command);
      const priced = await priceInSession(null, ctx, command, prices, modes);
      const totals = totalsOf(priced.map((p) => p.line), command.discount);
      const payments = command.payments === 'full'
        ? (totals.totalMinor > 0n ? [{ method: command.fullPaymentMethod, amountMinor: totals.totalMinor }] : [])
        : command.payments;
      const paid = payments.reduce((s, p) => s + p.amountMinor, 0n);
      if (paid > totals.totalMinor) throw badRequest('Ödeme toplamı satış tutarını aşamaz', 'OVERPAYMENT');
      return quoteDto(totals, payments);
    } catch (error) {
      throw asDomainError(error);
    }
  }

  /**
   * Creates a sale. `ctxIn` is the tenant context (routes always pass it);
   * `options.idempotency` = { key, remember } from withIdempotency.
   */
  async function createSale(payload, auditContext, ctxIn, options = {}) {
    const ctx = contextFor(ctxIn, auditContext);
    let command;
    try {
      command = parseSaleCommand(payload);
    } catch (error) {
      throw asDomainError(error);
    }
    // Validate the party inside the tenant BEFORE creating any ledger account
    // for it (accounts are never created for foreign or unknown ids).
    if (!(await Customer.exists({ _id: command.customerId, businessId: ctx.businessId, isArchived: { $ne: true } }))) {
      throw notFound('Müşteri bulunamadı', 'CUSTOMER_NOT_FOUND');
    }
    const { prices, modes, products } = await resolvePrices(ctx, command).catch((error) => { throw asDomainError(error); });

    // The sale happens in the branch that owns the stock — never implicitly
    // in the admin's own branch when the products belong to another one.
    const branch = await inventory.resolveDocumentBranch(ctx, products, payload?.branch, { assertBranch });
    const sctx = Object.freeze({ ...ctx, branch });
    const methods = command.payments === 'full' ? [command.fullPaymentMethod] : command.payments.map((p) => p.method);
    // POS provider / commission rule of each card payment (snapshotted at capture).
    const cardPlan = await pos.planPayments(ctx, branch, command.payments === 'full'
      ? [{ method: command.fullPaymentMethod, pos: command.fullPaymentPos }]
      : command.payments);
    // Fiscal and compliance rules of the business (BusinessProfile).
    const profile = await loadProfile(ctx.businessId);
    const vatSettings = profile.vat?.enabled ? { rateBp: profile.vat.standardRateBp } : null;
    const identificationThreshold = profile.compliance?.identificationThresholdMinor ?? null;
    await ledger.prepareAccounts(ctx.businessId, [
      ...(vatSettings ? [{ account: ACCOUNTS.vatPayable, unit: 'TRY' }] : []),
      { account: ACCOUNTS.receivable(command.customerId), unit: 'TRY' },
      { account: ACCOUNTS.revenue, unit: 'TRY' },
      { account: ACCOUNTS.cogs, unit: 'TRY' },
      { account: ACCOUNTS.inventory(branch), unit: 'TRY' },
      ...methods.map((m) => ({ account: paymentAccount(branch, m), unit: 'TRY' })),
      ...cardPlan.accounts,
    ]);

    try {
      return await tx(async (session) => {
        const customer = await Customer.findOne({ _id: command.customerId, businessId: ctx.businessId, isArchived: { $ne: true } }).session(session);
        if (!customer) throw notFound('Müşteri bulunamadı', 'CUSTOMER_NOT_FOUND');

        const priced = await priceInSession(session, ctx, command, prices, modes, { checkStock: true });
        const totals = totalsOf(priced.map((p) => p.line), command.discount);
        const payments = command.payments === 'full'
          ? (totals.totalMinor > 0n ? [{ method: command.fullPaymentMethod, amountMinor: totals.totalMinor }] : [])
          : command.payments;
        const paidMinor = payments.reduce((s, p) => s + p.amountMinor, 0n);
        if (paidMinor > totals.totalMinor) throw badRequest('Ödeme toplamı satış tutarını aşamaz', 'OVERPAYMENT');
        const balanceDue = totals.totalMinor - paidMinor;

        // MASAK: at or above the configured threshold the customer must be
        // identified (identity document on file); the identity is
        // snapshotted on the sale for the legally required record.
        let identification;
        if (identificationThreshold !== null && totals.totalMinor >= BigInt(identificationThreshold)) {
          if (!customer.identityType || !customer.identityNumber) {
            throw unprocessable(
              'Bu tutardaki işlem için müşterinin kimlik bilgisi (TCKN / pasaport) kayıtlı olmalıdır (MASAK kimlik tespiti)',
              'CUSTOMER_IDENTIFICATION_REQUIRED',
              { threshold: money(BigInt(identificationThreshold)) },
            );
          }
          identification = {
            thresholdMinor: identificationThreshold,
            identityType: customer.identityType,
            identityNumber: customer.identityNumber,
            customerName: customer.name,
          };
        }

        if (balanceDue > 0n && Number(customer.creditLimit) > 0) {
          const limit = parseDecimal(Number(customer.creditLimit), SCALE.MONEY, { round: true });
          const currentDebt = -BigInt(customer.balanceTryMinor || 0);
          if (currentDebt + balanceDue > limit) {
            throw conflict('Müşterinin kredi limiti aşılıyor; satış tamamlanamadı', 'CREDIT_LIMIT_EXCEEDED', {
              creditLimit: money(limit), currentDebt: money(currentDebt), requested: money(balanceDue),
            });
          }
        }

        const sale = new Sale({
          businessId: ctx.businessId,
          branch,
          customerId: customer._id,
          productId: totals.lines[0].productId,
          quantity: totals.lines.reduce((s, l) => s + l.quantity, 0),
          totalPrice: money(totals.totalMinor),
          paymentMethod: primaryMethod(payments),
          date: new Date(),
          createdBy: ctx.userId || undefined,
          notes: command.notes,
        });
        await sale.validate(); // assigns the sale number used in stock/ledger references
        const reference = { kind: 'Sale', id: String(sale._id) };

        let knownCost = 0n;
        let allCostsKnown = true;
        let vatTotal = 0n;
        const storedLines = [];
        for (let i = 0; i < totals.lines.length; i += 1) {
          const line = totals.lines[i];
          const moved = await inventory.moveProduct(session, sctx, {
            product: priced[i].product, quantity: -line.quantity, movementType: 'sale', reference, branch,
          });
          if (moved.costMinor === null) allCostsKnown = false;
          else knownCost += moved.costMinor;
          const vat = vatSettings
            ? lineVat({
              totalMinor: line.totalMinor,
              metalValueMinor: line.metalValueMinor === undefined ? null : line.metalValueMinor * BigInt(line.quantity),
              vatClass: resolveVatClass(priced[i].product),
              rateBp: vatSettings.rateBp,
            })
            : null;
          if (vat) vatTotal += vat.vatMinor;
          storedLines.push({
            ...line,
            fineMg: line.fineMg === undefined ? undefined : toSafeInteger(line.fineMg),
            weightMgPerUnit: line.weightMgPerUnit === undefined ? undefined : toSafeInteger(line.weightMgPerUnit),
            unitPriceMinor: toSafeInteger(line.unitPriceMinor),
            metalValueMinor: line.metalValueMinor === undefined ? undefined : toSafeInteger(line.metalValueMinor),
            laborMinor: line.laborMinor === undefined ? undefined : toSafeInteger(line.laborMinor),
            grossMinor: toSafeInteger(line.grossMinor),
            lineDiscountMinor: toSafeInteger(line.lineDiscountMinor),
            saleDiscountMinor: toSafeInteger(line.saleDiscountMinor),
            totalMinor: toSafeInteger(line.totalMinor),
            costMinor: moved.costMinor === null ? null : toSafeInteger(moved.costMinor),
            vat: vat ? {
              vatClass: vat.vatClass,
              rateBp: vat.rateBp,
              basis: vat.basis,
              taxableGrossMinor: toSafeInteger(vat.taxableGrossMinor),
              vatMinor: toSafeInteger(vat.vatMinor),
            } : undefined,
            returnedQuantity: 0,
          });
        }

        // Revenue (net of KDV) + KDV payable + receivable; cost of goods sold
        // for the part with known cost.
        const saleLines = [
          debit(ACCOUNTS.receivable(customer._id), 'TRY', totals.totalMinor, { customerId: customer._id }),
          credit(ACCOUNTS.revenue, 'TRY', totals.totalMinor - vatTotal),
          ...(vatTotal > 0n ? [credit(ACCOUNTS.vatPayable, 'TRY', vatTotal)] : []),
          debit(ACCOUNTS.cogs, 'TRY', knownCost),
          credit(ACCOUNTS.inventory(branch), 'TRY', knownCost),
        ];
        let saleEntry = null;
        if (totals.totalMinor > 0n || knownCost > 0n) {
          saleEntry = await ledger.postEntry(session, sctx, {
            entryType: 'sale', lines: saleLines, reference, description: `Satış #${sale._id}`, branch,
          });
        }

        const storedPayments = [];
        if (payments.length) {
          const paymentEntry = await ledger.postEntry(session, sctx, {
            entryType: 'sale_payment',
            reference,
            branch,
            description: `Satış #${sale._id} tahsilatı`,
            lines: [
              ...payments.map((p) => debit(paymentAccount(branch, p.method), 'TRY', p.amountMinor)),
              credit(ACCOUNTS.receivable(customer._id), 'TRY', paidMinor, { customerId: customer._id }),
            ],
          });
          for (const p of payments) {
            storedPayments.push({ kind: 'payment', method: p.method, amountMinor: toSafeInteger(p.amountMinor), source: 'sale', journalEntryId: paymentEntry._id, createdBy: ctx.userId || null });
          }
          await pos.recordCaptures(session, sctx, {
            branch, payments, plans: cardPlan.plans, reference, source: 'sale', journalEntryId: paymentEntry._id,
          });
        }

        const single = storedLines.length === 1 ? storedLines[0] : null;
        sale.set({
          lines: storedLines,
          subtotalMinor: toSafeInteger(totals.subtotalMinor),
          discountMinor: toSafeInteger(totals.discountMinor),
          totalMinor: toSafeInteger(totals.totalMinor),
          vatMinor: vatSettings ? toSafeInteger(vatTotal) : undefined,
          identification,
          returnedMinor: 0,
          paidMinor: toSafeInteger(paidMinor),
          balanceDueMinor: toSafeInteger(balanceDue),
          paymentStatus: paymentStatusOf(totals.totalMinor, paidMinor),
          payments: storedPayments,
          returns: [],
          journalEntryId: saleEntry ? saleEntry._id : undefined,
          unitPriceAtSale: single ? money(single.unitPriceMinor) : undefined,
          unitCostAtSale: single && allCostsKnown
            ? toDisplayNumber(roundDiv(BigInt(single.costMinor), BigInt(single.quantity), ROUNDING_MODE), 2)
            : null,
        });
        await sale.save({ session });

        if (options.idempotency) await options.idempotency.remember(session, { resourceType: 'Sale', resourceId: sale._id, statusCode: 201 });
        await audit(session, ctx, 'sale.created', sale, {
          after: {
            customerId: sale.customerId,
            productId: sale.productId,
            quantity: sale.quantity,
            totalPrice: sale.totalPrice,
            unitPriceAtSale: sale.unitPriceAtSale,
            unitCostAtSale: sale.unitCostAtSale,
            lines: storedLines.map((l) => ({ productId: l.productId, quantity: l.quantity, totalMinor: l.totalMinor, priceType: l.price?.priceType })),
            paidMinor: sale.paidMinor,
            balanceDueMinor: sale.balanceDueMinor,
          },
        });
        return sale;
      });
    } catch (error) {
      throw asDomainError(error);
    }
  }

  async function loadSaleForUpdate(session, ctx, id) {
    const saleId = parseNumericId(id, 'satış');
    const sale = await Sale.findOne({ _id: saleId, businessId: ctx.businessId }).session(session);
    if (!sale) throw notFound('Satış bulunamadı', 'SALE_NOT_FOUND');
    if (sale.branch && sale.branch !== ctx.branch && !ctx.isAdmin) throw notFound('Satış bulunamadı', 'SALE_NOT_FOUND');
    return sale;
  }

  function assertJournaled(sale) {
    if (sale.totalMinor === undefined || sale.totalMinor === null) {
      throw conflict('Bu satış eski sistemde oluşturulmuş; tahsilat/iade yerine iptal kullanın', 'LEGACY_SALE');
    }
  }

  /** Payment against a sale's outstanding balance (satış tahsilatı). */
  async function recordPayment(id, payload, ctxIn, options = {}) {
    const ctx = contextFor(ctxIn);
    const method = payload?.method;
    if (!SALE_PAYMENT_METHODS.includes(method)) throw badRequest('Geçersiz ödeme yöntemi');
    let amount;
    try {
      amount = parseAmount(payload?.amount, 'Tahsilat tutarı');
    } catch (error) {
      throw asDomainError(error);
    }
    const preview = await Sale.findOne({ _id: parseNumericId(id, 'satış'), businessId: ctx.businessId }).select('customerId branch').lean();
    if (!preview || !visibleTo(ctx, preview)) throw notFound('Satış bulunamadı', 'SALE_NOT_FOUND');
    // A collection against a sale is booked to the sale's branch (its till, POS and receivable history).
    const branch = preview.branch || ctx.branch;
    const sctx = Object.freeze({ ...ctx, branch });
    const cardPayments = [{ method, amountMinor: amount, pos: payload?.pos }];
    const cardPlan = await pos.planPayments(sctx, branch, cardPayments);
    await ledger.prepareAccounts(ctx.businessId, [
      { account: paymentAccount(branch, method), unit: 'TRY' },
      { account: ACCOUNTS.receivable(preview.customerId), unit: 'TRY' },
      ...cardPlan.accounts,
    ]);
    try {
      return await tx(async (session) => {
        const sale = await loadSaleForUpdate(session, ctx, id);
        assertJournaled(sale);
        if (sale.status === 'cancelled') throw conflict('İptal edilmiş satışa tahsilat yapılamaz', 'SALE_CANCELLED');
        const due = BigInt(sale.balanceDueMinor || 0);
        if (amount > due) throw badRequest(`Tahsilat tutarı kalan borcu (${format(due, 2)} TL) aşamaz`, 'OVERPAYMENT');
        if ((sale.branch || ctx.branch) !== branch) throw conflict('Satışın şubesi bu işlem sırasında değişti', 'SALE_CHANGED');
        const reference = { kind: 'Sale', id: String(sale._id) };
        const entry = await ledger.postEntry(session, sctx, {
          entryType: 'sale_payment',
          reference,
          branch,
          description: `Satış #${sale._id} tahsilatı`,
          lines: [
            debit(paymentAccount(branch, method), 'TRY', amount),
            credit(ACCOUNTS.receivable(sale.customerId), 'TRY', amount, { customerId: sale.customerId }),
          ],
        });
        applyPaymentToSale(sale, { method, amountMinor: amount, source: 'sale_collection', journalEntryId: entry._id, createdBy: ctx.userId });
        await pos.recordCaptures(session, sctx, {
          branch, payments: cardPayments, plans: cardPlan.plans, reference, source: 'sale_collection', journalEntryId: entry._id,
        });
        await sale.save({ session });
        if (options.idempotency) await options.idempotency.remember(session, { resourceType: 'Sale', resourceId: sale._id, statusCode: 200 });
        await audit(session, ctx, 'sale.payment_recorded', sale, { after: { method, amountMinor: toSafeInteger(amount), balanceDueMinor: sale.balanceDueMinor } });
        return { sale, journalEntry: entry };
      });
    } catch (error) {
      throw asDomainError(error);
    }
  }

  /**
   * Partial or full return of sold items.
   * payload: { lines: [{ lineId, quantity }], refundMethod, reason }
   */
  async function returnSale(id, payload, ctxIn, options = {}) {
    const ctx = contextFor(ctxIn);
    if (!payload || !Array.isArray(payload.lines) || !payload.lines.length) throw badRequest('İade edilecek satırlar belirtilmelidir');
    const refundMethod = payload.refundMethod || 'cari';
    if (!REFUND_METHODS.includes(refundMethod)) throw badRequest('Geçersiz iade yöntemi');
    const requested = payload.lines.map((l) => {
      const lineId = Number(l?.lineId);
      const quantity = Number(l?.quantity);
      if (!Number.isSafeInteger(lineId) || !Number.isSafeInteger(quantity) || quantity <= 0) throw badRequest('İade satırı geçersiz');
      return { lineId, quantity };
    });
    if (new Set(requested.map((r) => r.lineId)).size !== requested.length) throw badRequest('Aynı satır birden fazla kez iade edilemez');

    const preview = await Sale.findOne({ _id: parseNumericId(id, 'satış'), businessId: ctx.businessId }).select('customerId branch vatMinor').lean();
    if (!preview || !visibleTo(ctx, preview)) throw notFound('Satış bulunamadı', 'SALE_NOT_FOUND');
    // Returned goods go back into the stock (and inventory account) of the
    // sale's branch — the branch that issued them — never the caller's branch.
    const branch = preview.branch || ctx.branch;
    const sctx = Object.freeze({ ...ctx, branch });
    await ledger.prepareAccounts(ctx.businessId, [
      { account: ACCOUNTS.receivable(preview.customerId), unit: 'TRY' },
      { account: ACCOUNTS.salesReturns, unit: 'TRY' },
      { account: ACCOUNTS.cogs, unit: 'TRY' },
      { account: ACCOUNTS.inventory(branch), unit: 'TRY' },
      ...(preview.vatMinor > 0 ? [{ account: ACCOUNTS.vatPayable, unit: 'TRY' }] : []),
      ...(refundMethod !== 'cari' ? [{ account: paymentAccount(branch, refundMethod), unit: 'TRY' }] : []),
      ...(refundMethod === 'kredi kartı' ? pos.refundAccounts(branch) : []),
    ]);

    try {
      return await tx(async (session) => {
        const sale = await loadSaleForUpdate(session, ctx, id);
        assertJournaled(sale);
        if ((sale.branch || ctx.branch) !== branch) throw conflict('Satışın şubesi bu işlem sırasında değişti', 'SALE_CHANGED');
        if (!['completed', 'partially_returned'].includes(sale.status)) throw conflict('Bu satış iade edilemez durumda', 'SALE_NOT_RETURNABLE');
        const reference = { kind: 'Sale', id: String(sale._id) };
        const returnId = (sale.returns?.length || 0) + 1;

        let amountTotal = 0n;
        let costTotal = 0n;
        let vatReturned = 0n;
        const returnLines = [];
        for (const req of requested) {
          const line = sale.lines.find((l) => l.lineId === req.lineId);
          if (!line) throw badRequest(`Satır bulunamadı: ${req.lineId}`, 'SALE_LINE_NOT_FOUND');
          const already = line.returnedQuantity || 0;
          if (already + req.quantity > line.quantity) {
            throw conflict(`${line.productName}: en fazla ${line.quantity - already} adet iade edilebilir`, 'RETURN_EXCEEDS_SOLD');
          }
          // Cumulative proportional amounts: returning every unit refunds the line total exactly.
          const portion = (total, n) => roundDiv(BigInt(total) * BigInt(n), BigInt(line.quantity), ROUNDING_MODE);
          const amount = portion(line.totalMinor, already + req.quantity) - portion(line.totalMinor, already);
          const cost = line.costMinor === null || line.costMinor === undefined
            ? null
            : portion(line.costMinor, already + req.quantity) - portion(line.costMinor, already);

          const product = await inventory.loadProduct(session, ctx, line.productId, { allowArchived: true });
          await inventory.moveProduct(session, sctx, {
            product, quantity: req.quantity, movementType: 'sale_return', costMinor: cost, reference, reason: payload.reason, branch,
          });
          // KDV of the returned units is reversed proportionally (cumulative,
          // so returning every unit reverses the line's KDV exactly).
          const vat = line.vat?.vatMinor ? returnedVat(line.vat.vatMinor, line.quantity, already, req.quantity) : 0n;
          line.returnedQuantity = already + req.quantity;
          amountTotal += amount;
          vatReturned += vat;
          if (cost !== null) costTotal += cost;
          returnLines.push({
            lineId: line.lineId,
            quantity: req.quantity,
            amountMinor: toSafeInteger(amount),
            costMinor: cost === null ? null : toSafeInteger(cost),
            vatMinor: line.vat ? toSafeInteger(vat) : undefined,
          });
        }

        const entry = await ledger.postEntry(session, sctx, {
          entryType: 'sale_return',
          reference,
          branch,
          description: `Satış #${sale._id} iadesi`,
          lines: [
            debit(ACCOUNTS.salesReturns, 'TRY', amountTotal - vatReturned),
            ...(vatReturned > 0n ? [debit(ACCOUNTS.vatPayable, 'TRY', vatReturned)] : []),
            credit(ACCOUNTS.receivable(sale.customerId), 'TRY', amountTotal, { customerId: sale.customerId }),
            debit(ACCOUNTS.inventory(branch), 'TRY', costTotal),
            credit(ACCOUNTS.cogs, 'TRY', costTotal),
          ],
        });

        const returnedMinor = BigInt(sale.returnedMinor || 0) + amountTotal;
        const netMinor = BigInt(sale.totalMinor) - returnedMinor;
        let paidMinor = BigInt(sale.paidMinor || 0);
        // Money already paid beyond the new net value is refunded (or stays as account credit).
        let refundMinor = 0n;
        if (refundMethod !== 'cari' && paidMinor > netMinor) {
          refundMinor = paidMinor - netMinor;
          if (refundMinor > amountTotal) refundMinor = amountTotal;
          const refundEntry = await ledger.postEntry(session, sctx, {
            entryType: 'sale_refund',
            reference,
            branch,
            description: `Satış #${sale._id} iade ödemesi`,
            lines: [
              debit(ACCOUNTS.receivable(sale.customerId), 'TRY', refundMinor, { customerId: sale.customerId }),
              credit(paymentAccount(branch, refundMethod), 'TRY', refundMinor),
            ],
          });
          paidMinor -= refundMinor;
          sale.payments.push({ kind: 'refund', method: refundMethod, amountMinor: toSafeInteger(refundMinor), source: 'return', journalEntryId: refundEntry._id, createdBy: ctx.userId || null });
          if (refundMethod === 'kredi kartı') {
            await pos.recordRefund(session, sctx, {
              branch, grossMinor: refundMinor, originals: await pos.paymentsOf(session, ctx, reference), reference, source: 'sale_return', journalEntryId: refundEntry._id,
            });
          }
        }

        sale.returns.push({
          returnId, lines: returnLines, amountMinor: toSafeInteger(amountTotal), refundMinor: toSafeInteger(refundMinor),
          refundMethod, reason: payload.reason, journalEntryId: entry._id, createdBy: ctx.userId || null,
        });
        sale.returnedMinor = toSafeInteger(returnedMinor);
        sale.paidMinor = toSafeInteger(paidMinor);
        sale.balanceDueMinor = toSafeInteger(netMinor > paidMinor ? netMinor - paidMinor : 0n);
        sale.paymentStatus = netMinor <= 0n && paidMinor <= 0n ? 'refunded' : paymentStatusOf(netMinor, paidMinor);
        const fullyReturned = sale.lines.every((l) => (l.returnedQuantity || 0) >= l.quantity);
        sale.status = fullyReturned ? 'returned' : 'partially_returned';
        sale.markModified('lines');
        await sale.save({ session });

        if (options.idempotency) await options.idempotency.remember(session, { resourceType: 'Sale', resourceId: sale._id, statusCode: 200 });
        await audit(session, ctx, 'sale.returned', sale, {
          after: { returnId, amountMinor: toSafeInteger(amountTotal), refundMinor: toSafeInteger(refundMinor), refundMethod, lines: returnLines },
        });
        return { sale, returnId };
      });
    } catch (error) {
      throw asDomainError(error);
    }
  }

  /**
   * Cancels (voids) a sale: stock is restored at the original cost, the sale
   * entry is reversed and payments taken at the sale / against the sale are
   * refunded through the same method. Collections allocated from the
   * customer's account stay on the account as credit.
   */
  async function cancelSale(id, auditContext, ctxIn) {
    const ctx = contextFor(ctxIn, auditContext);
    const saleId = parseNumericId(id, 'satış');
    const preview = await Sale.findOne({ _id: saleId, businessId: ctx.businessId }).select('payments customerId branch').lean();
    if (preview && visibleTo(ctx, preview)) {
      const previewBranch = preview.branch || ctx.branch;
      await ledger.prepareAccounts(ctx.businessId, [
        { account: ACCOUNTS.receivable(preview.customerId), unit: 'TRY' },
        { account: ACCOUNTS.inventory(previewBranch), unit: 'TRY' },
        ...((preview.payments || []).filter((p) => p.method !== 'cari').map((p) => ({ account: paymentAccount(previewBranch, p.method), unit: 'TRY' }))),
        ...((preview.payments || []).some((p) => p.method === 'kredi kartı') ? pos.refundAccounts(previewBranch) : []),
      ]);
    }
    try {
      return await tx(async (session) => {
        const sale = await Sale.findOne({ _id: saleId, businessId: ctx.businessId }).session(session);
        if (!sale) throw httpError('Satış bulunamadı', 404, 'SALE_NOT_FOUND');
        if (sale.branch && sale.branch !== ctx.branch && !ctx.isAdmin) throw httpError('Satış bulunamadı', 404, 'SALE_NOT_FOUND');
        if (sale.status === 'cancelled') throw httpError('Bu satış daha önce iptal edilmiş', 409, 'SALE_CANCELLED');
        if (sale.returns?.length) throw conflict('İadesi yapılmış satış iptal edilemez; kalan ürünleri iade edin', 'SALE_HAS_RETURNS');
        // Stock comes back to the branch that sold it (its inventory account was credited).
        const saleBranch = sale.branch || ctx.branch;
        const sctx = Object.freeze({ ...ctx, branch: saleBranch });

        const reference = { kind: 'Sale', id: String(sale._id) };
        const lines = sale.lines?.length
          ? sale.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, costMinor: l.costMinor }))
          : [{ productId: sale.productId, quantity: sale.quantity, costMinor: undefined }];

        for (const line of lines) {
          const product = await Product.findOne({ _id: line.productId, businessId: ctx.businessId }).session(session);
          if (!product) throw httpError('Ürün kaydı bulunamadığı için stok geri yüklenemedi', 409, 'STOCK_RESTORE_PRODUCT_MISSING');
          let cost = null;
          if (line.costMinor !== null && line.costMinor !== undefined) cost = BigInt(line.costMinor);
          else if (line.costMinor === undefined && sale.unitCostAtSale !== null && sale.unitCostAtSale !== undefined) {
            // Legacy sale: the recorded unit cost is the issued cost.
            cost = parseDecimal(sale.unitCostAtSale, SCALE.MONEY, { round: true }) * BigInt(line.quantity);
          }
          const pool = inventory.effectivePool(product);
          if (cost !== null && pool === null && (product.stock || 0) > 0) cost = null;
          if (cost === null && pool !== null && (product.stock || 0) > 0) {
            // Cannot add cost-unknown units to a known pool: value them at the current average.
            cost = inventory.issueCost(pool, product.stock, line.quantity);
          }
          await inventory.moveProduct(session, sctx, {
            product, quantity: line.quantity, movementType: 'sale_cancel', costMinor: cost, reference, branch: saleBranch,
          });
        }

        let cancelEntry = null;
        if (sale.journalEntryId) {
          cancelEntry = await ledger.reverseEntry(session, sctx, sale.journalEntryId, {
            entryType: 'sale_cancel', description: `Satış #${sale._id} iptali`, reference,
          });
        }
        const refundable = (sale.payments || []).filter((p) => p.kind === 'payment' && ['sale', 'sale_collection'].includes(p.source));
        const refundedEntries = new Set();
        for (const p of refundable) {
          const key = String(p.journalEntryId);
          if (!p.journalEntryId || refundedEntries.has(key)) continue;
          refundedEntries.add(key);
          await ledger.reverseEntry(session, sctx, p.journalEntryId, {
            entryType: 'sale_refund', description: `Satış #${sale._id} iptal iadesi`, reference,
          });
          // The mirror credits the card account with every card payment of that entry.
          const cardGross = refundable
            .filter((x) => x.method === 'kredi kartı' && String(x.journalEntryId) === key)
            .reduce((sum, x) => sum + BigInt(x.amountMinor), 0n);
          if (cardGross > 0n) {
            const originals = await pos.paymentsOf(session, ctx, reference, { journalEntryId: p.journalEntryId });
            await pos.recordRefund(session, sctx, {
              branch: saleBranch, grossMinor: cardGross, originals, reference, source: 'sale_cancel', journalEntryId: p.journalEntryId, useOriginalBranch: true,
            });
          }
        }
        const refundedMinor = refundable.reduce((s, p) => s + BigInt(p.amountMinor), 0n);

        const updated = await Sale.findOneAndUpdate(
          { _id: sale._id, businessId: ctx.businessId, status: { $ne: 'cancelled' } },
          {
            $set: {
              status: 'cancelled',
              cancelledAt: new Date(),
              ...(cancelEntry ? { cancelJournalEntryId: cancelEntry._id } : {}),
              ...(sale.totalMinor !== undefined && sale.totalMinor !== null
                ? {
                  paidMinor: toSafeInteger(BigInt(sale.paidMinor || 0) - refundedMinor),
                  balanceDueMinor: 0,
                  paymentStatus: 'refunded',
                }
                : {}),
            },
            ...(refundedMinor > 0n
              ? { $push: { payments: { $each: refundable.map((p) => ({ kind: 'refund', method: p.method, amountMinor: p.amountMinor, source: 'sale', createdBy: ctx.userId || null })) } } }
              : {}),
          },
          { new: true, session },
        );
        if (!updated) throw httpError('Satış başka bir işlem tarafından iptal edildi', 409, 'SALE_CHANGED');

        await audit(session, ctx, 'sale.cancelled', sale, {
          before: { status: sale.status, quantity: sale.quantity, productId: sale.productId },
          after: { status: updated.status, cancelledAt: updated.cancelledAt, refundedMinor: toSafeInteger(refundedMinor) },
        });
        return updated;
      });
    } catch (error) {
      throw asDomainError(error);
    }
  }

  /**
   * Metadata update. Financial facts of journaled sales (amounts, payment
   * method, date) are locked — corrections go through payments, returns or
   * cancellation. Legacy sales keep the old editable paymentMethod/date.
   */
  async function updateSale(id, payload, auditContext, ctxIn) {
    const ctx = contextFor(ctxIn, auditContext);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw httpError('Geçerli bir güncelleme gönderilmelidir', 400, 'NO_UPDATABLE_FIELDS');
    }
    const allowed = {};
    if (payload.paymentMethod !== undefined) {
      if (!['nakit', 'kredi kartı', 'havale'].includes(payload.paymentMethod)) throw httpError('Geçersiz ödeme yöntemi', 400, 'INVALID_PAYMENT_METHOD');
      allowed.paymentMethod = payload.paymentMethod;
    }
    if (payload.date !== undefined) {
      const date = new Date(payload.date);
      if (Number.isNaN(date.getTime())) throw httpError('Geçersiz satış tarihi', 400, 'INVALID_SALE_DATE');
      allowed.date = date;
    }
    if (typeof payload.notes === 'string') allowed.notes = payload.notes.trim().slice(0, 1000);
    if (!Object.keys(allowed).length) {
      throw httpError('Satışın ürün, miktar ve tutar bilgileri sonradan değiştirilemez', 400, 'SALE_FINANCIALS_LOCKED');
    }

    const updateWork = async (session) => {
      const current = await Sale.findOne({ _id: id, businessId: ctx.businessId }).session(session);
      // Another branch's sale behaves like a missing one (notes / legacy payment fields are branch data too).
      if (!current || current.status === 'cancelled' || !visibleTo(ctx, current)) throw httpError('Aktif satış bulunamadı', 404, 'SALE_NOT_FOUND');
      const journaled = current.totalMinor !== undefined && current.totalMinor !== null;
      if (journaled && (allowed.paymentMethod !== undefined || allowed.date !== undefined)) {
        const changed = (allowed.paymentMethod !== undefined && allowed.paymentMethod !== current.paymentMethod)
          || (allowed.date !== undefined && allowed.date.getTime() !== current.date.getTime());
        if (changed) {
          throw conflict('Muhasebeleşmiş satışın ödeme yöntemi ve tarihi değiştirilemez; iade veya iptal kullanın', 'SALE_FINANCIALS_LOCKED');
        }
        delete allowed.paymentMethod;
        delete allowed.date;
      }
      if (!Object.keys(allowed).length) return current;
      const sale = await Sale.findOneAndUpdate(
        { _id: id, businessId: ctx.businessId, status: { $ne: 'cancelled' } },
        { $set: allowed },
        { new: true, runValidators: true, session },
      );
      if (!sale) throw httpError('Satış başka bir işlem tarafından güncellendi', 409, 'SALE_CHANGED');
      if (AuditLog && ctx.userId) {
        await recordAudit({
          AuditLog,
          session,
          actorUserId: ctx.userId,
          action: 'sale.updated',
          resourceType: 'Sale',
          resourceId: sale._id,
          correlationId: ctx.correlationId,
          before: { paymentMethod: current.paymentMethod, date: current.date },
          after: allowed,
        });
      }
      return sale;
    };
    try {
      return await tx(updateWork);
    } catch (error) {
      throw asDomainError(error);
    }
  }

  return { quoteSale, createSale, recordPayment, returnSale, cancelSale, updateSale };
}

/**
 * Records a payment on a sale document (no journal posting — the caller
 * already posted the entry).
 */
function applyPaymentToSale(sale, { method, amountMinor, source, journalEntryId, createdBy }) {
  const paid = BigInt(sale.paidMinor || 0) + BigInt(amountMinor);
  const net = BigInt(sale.totalMinor) - BigInt(sale.returnedMinor || 0);
  sale.payments.push({ kind: 'payment', method, amountMinor: toSafeInteger(BigInt(amountMinor)), source, journalEntryId, createdBy: createdBy || null });
  sale.paidMinor = toSafeInteger(paid);
  sale.balanceDueMinor = toSafeInteger(net > paid ? net - paid : 0n);
  sale.paymentStatus = paymentStatusOf(net, paid);
}

/**
 * Allocates a customer collection posted to the receivable account to the
 * customer's open sales, oldest first (open-item clearing). The journal
 * entry already exists; this only updates the sales' payment state.
 */
async function allocateCollectionToSales(session, ctx, { customerId, amountMinor, method, journalEntryId }) {
  let left = BigInt(amountMinor);
  const allocations = [];
  if (left <= 0n) return allocations;
  const open = await SaleModel.find({
    businessId: ctx.businessId,
    customerId,
    status: { $in: ['completed', 'partially_returned'] },
    balanceDueMinor: { $gt: 0 },
  }).sort({ date: 1, _id: 1 }).session(session);
  for (const sale of open) {
    if (left <= 0n) break;
    const due = BigInt(sale.balanceDueMinor);
    const part = due < left ? due : left;
    applyPaymentToSale(sale, { method: method === 'cari' ? 'cari' : method, amountMinor: part, source: 'account_collection', journalEntryId, createdBy: ctx.userId });
    await sale.save({ session });
    allocations.push({ saleId: sale._id, amountMinor: toSafeInteger(part) });
    left -= part;
  }
  return allocations;
}

module.exports = {
  createSalesService,
  httpError,
  parseSaleCommand,
  financialView,
  lineDto,
  allocateCollectionToSales,
  applyPaymentToSale,
  DomainError,
};
