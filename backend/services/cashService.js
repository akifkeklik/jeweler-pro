/**
 * Cash register, account vouchers (kasa / cari fişleri), daily Z-report and
 * account statements — all derived from the double-entry ledger.
 * Business rules: backend/BUSINESS_RULES.md → "Cash & accounts".
 */
const CashTransaction = require('../models/CashTransaction');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const Sale = require('../models/Sale');
const DailyClosing = require('../models/DailyClosing');
const AccountBalance = require('../models/AccountBalance');
const LedgerEntry = require('../models/LedgerEntry');
const AuditLog = require('../models/AuditLog');
const { recordAudit } = require('../utils/audit');
const { parseDecimal, toSafeInteger, toDisplayNumber, DecimalError } = require('../domain/decimal');
const { SCALE, LIMITS } = require('../domain/precision');
const { resolvePurity, fineWeightMg, assertMetal } = require('../domain/metals');
const { priceMetalPurchase } = require('../domain/pricing');
const ledger = require('./finance/ledgerService');
const inventory = require('./finance/inventoryService');
const { resolveMetalPrices } = require('./finance/metalPricing');
const { allocateCollectionToSales } = require('./salesService');
const { allocateSupplierPayment } = require('./purchaseService');
const pos = require('./posService');
const { assertBranch } = require('./finance/branchDirectory');
const { localDateString, localDayRange } = require('../utils/timeZone');
const {
  badRequest, notFound, conflict, forbidden, runInTransaction, parseNumericId,
} = require('./finance/core');

const { ACCOUNTS, paymentAccount, debit, credit } = ledger;
const TYPES = ['tahsilat', 'tediye', 'gider', 'devir', 'satis_tahsilati', 'hurda_alimi'];
const METHODS = ['nakit', 'kredi kartı', 'havale'];
const money = (minor) => toDisplayNumber(minor, SCALE.MONEY);
const grams = (mg) => toDisplayNumber(mg, SCALE.WEIGHT);

function wrap(error) {
  if (error instanceof DecimalError) return badRequest(error.message, error.code);
  return error;
}

function optionalAmount(value, scale, field, max) {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') return 0n;
  return parseDecimal(value, scale, { field, max });
}

function sanitizeCategory(value) {
  const text = String(value || 'genel').trim().toLowerCase().replace(/[^a-z0-9çğıöşü_-]+/g, '_').slice(0, 40);
  return text || 'genel';
}

/** Validates the voucher payload into a typed command. */
function parseVoucher(body) {
  if (!body || typeof body !== 'object') throw badRequest('Geçerli bir kasa fişi gönderilmelidir');
  const { type } = body;
  if (!TYPES.includes(type)) throw badRequest('Geçersiz işlem türü');
  const amountTryMinor = optionalAmount(body.amountTry, SCALE.MONEY, 'Tutar (TL)', LIMITS.MAX_MONEY_MINOR);
  const amountGoldMg = optionalAmount(body.amountGoldGrams, SCALE.WEIGHT, 'Altın miktarı (gr)', LIMITS.MAX_WEIGHT_MG);
  let method = body.paymentMethod || 'nakit';
  if (method === 'altın') method = 'nakit'; // legacy label for gold-only vouchers; TRY part (if any) is cash
  if (![...METHODS, 'cari'].includes(method)) throw badRequest('Geçersiz ödeme yöntemi');
  const customerId = body.customerId === undefined || body.customerId === null || body.customerId === '' ? null : parseNumericId(body.customerId, 'müşteri');
  const supplierId = body.supplierId === undefined || body.supplierId === null || body.supplierId === '' ? null : parseNumericId(body.supplierId, 'tedarikçi');
  if (customerId && supplierId) throw badRequest('Bir fiş aynı anda müşteri ve tedarikçiye kesilemez');
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) : '';
  return { type, amountTryMinor, amountGoldMg, method, customerId, supplierId, description, body };
}

async function loadCustomer(session, ctx, id) {
  const customer = await Customer.findOne({ _id: id, businessId: ctx.businessId }).session(session);
  if (!customer) throw notFound('Müşteri bulunamadı', 'CUSTOMER_NOT_FOUND');
  return customer;
}

async function loadSupplier(session, ctx, id) {
  const supplier = await Supplier.findOne({ _id: id, businessId: ctx.businessId }).session(session);
  if (!supplier) throw notFound('Tedarikçi bulunamadı', 'SUPPLIER_NOT_FOUND');
  return supplier;
}

/**
 * Builds the journal lines of a voucher. Returns
 * { entryType, lines, accounts, scrap? } — `accounts` are prepared before the txn.
 */
async function planVoucher(ctx, v) {
  const b = ctx.branch;
  const tryAcct = v.method === 'cari' ? null : paymentAccount(b, v.method);
  const cust = v.customerId;
  const supp = v.supplierId;
  const lines = [];
  let entryType;

  const requireAmounts = (allowGold = true) => {
    if (!allowGold && v.amountGoldMg > 0n) throw badRequest('Bu işlem türünde altın miktarı kullanılamaz');
    if (v.amountTryMinor <= 0n && v.amountGoldMg <= 0n) throw badRequest('İşlem tutarı (TL) veya altın miktarı pozitif olmalıdır');
    if (v.amountTryMinor > 0n && !tryAcct) throw badRequest('TL tutarı için nakit, kredi kartı veya havale seçilmelidir');
  };

  switch (v.type) {
    case 'tahsilat': {
      if (!cust) throw badRequest('Tahsilat için müşteri seçilmelidir');
      if (supp) throw badRequest('Tahsilat müşteriden yapılır');
      requireAmounts(true);
      entryType = v.amountTryMinor > 0n ? 'collection' : 'gold_collection';
      if (v.amountTryMinor > 0n) lines.push(debit(tryAcct, 'TRY', v.amountTryMinor), credit(ACCOUNTS.receivable(cust), 'TRY', v.amountTryMinor, { customerId: cust }));
      if (v.amountGoldMg > 0n) lines.push(debit(ACCOUNTS.goldTill(b), 'XAU', v.amountGoldMg), credit(ACCOUNTS.receivable(cust), 'XAU', v.amountGoldMg, { customerId: cust }));
      break;
    }
    case 'tediye': {
      if (!cust && !supp) throw badRequest('Tediye için müşteri veya tedarikçi seçilmelidir');
      requireAmounts(Boolean(cust));
      if (cust) {
        entryType = v.amountTryMinor > 0n ? 'customer_payment' : 'gold_payment';
        if (v.amountTryMinor > 0n) lines.push(debit(ACCOUNTS.receivable(cust), 'TRY', v.amountTryMinor, { customerId: cust }), credit(tryAcct, 'TRY', v.amountTryMinor));
        if (v.amountGoldMg > 0n) lines.push(debit(ACCOUNTS.receivable(cust), 'XAU', v.amountGoldMg, { customerId: cust }), credit(ACCOUNTS.goldTill(b), 'XAU', v.amountGoldMg));
      } else {
        entryType = 'supplier_payment';
        lines.push(debit(ACCOUNTS.payable(supp), 'TRY', v.amountTryMinor, { supplierId: supp }), credit(tryAcct, 'TRY', v.amountTryMinor));
      }
      break;
    }
    case 'gider': {
      if (cust || supp) throw badRequest('Gider fişi cari hesaba bağlanamaz');
      requireAmounts(false);
      entryType = 'expense';
      lines.push(debit(ACCOUNTS.expense(sanitizeCategory(v.body.expenseCategory)), 'TRY', v.amountTryMinor), credit(tryAcct, 'TRY', v.amountTryMinor));
      break;
    }
    case 'devir': {
      if (!cust && !supp) {
        requireAmounts(true);
        entryType = 'cash_opening';
        if (v.amountTryMinor > 0n) lines.push(debit(tryAcct, 'TRY', v.amountTryMinor), credit(ACCOUNTS.openingEquity, 'TRY', v.amountTryMinor));
        if (v.amountGoldMg > 0n) lines.push(debit(ACCOUNTS.goldTill(b), 'XAU', v.amountGoldMg), credit(ACCOUNTS.openingEquity, 'XAU', v.amountGoldMg));
      } else {
        const direction = v.body.direction;
        if (!['borc', 'alacak'].includes(direction)) {
          throw badRequest('Cari devir için yön (borc: cari bize borçlu, alacak: biz cariye borçluyuz) belirtilmelidir');
        }
        if (v.amountTryMinor <= 0n && v.amountGoldMg <= 0n) throw badRequest('Devir tutarı pozitif olmalıdır');
        if (supp && v.amountGoldMg > 0n) throw badRequest('Tedarikçi devri yalnızca TL olabilir');
        entryType = cust ? 'customer_opening' : 'supplier_opening';
        const account = cust ? ACCOUNTS.receivable(cust) : ACCOUNTS.payable(supp);
        const party = cust ? { customerId: cust } : { supplierId: supp };
        for (const [unit, amount] of [['TRY', v.amountTryMinor], ['XAU', v.amountGoldMg]]) {
          if (amount <= 0n) continue;
          if (direction === 'borc') lines.push(debit(account, unit, amount, party), credit(ACCOUNTS.openingEquity, unit, amount));
          else lines.push(debit(ACCOUNTS.openingEquity, unit, amount), credit(account, unit, amount, party));
        }
      }
      break;
    }
    case 'hurda_alimi': {
      if (supp) throw badRequest('Hurda alımı müşteriden veya perakende yapılır');
      const metal = assertMetal(v.body.metal || 'XAU');
      let weightMg;
      let purity;
      if (v.body.weightGrams !== undefined && v.body.weightGrams !== null && v.body.weightGrams !== '') {
        weightMg = parseDecimal(v.body.weightGrams, SCALE.WEIGHT, { field: 'Gramaj', allowZero: false, max: LIMITS.MAX_WEIGHT_MG });
        purity = resolvePurity(v.body);
      } else if (v.amountGoldMg > 0n) {
        // Legacy voucher: amountGoldGrams is fine (has) gold.
        weightMg = v.amountGoldMg;
        purity = 10000n;
      } else {
        throw badRequest('Hurda alımı için gramaj ve ayar/saflık girilmelidir');
      }
      const fineMg = fineWeightMg(weightMg, purity);
      let amount = v.amountTryMinor;
      let priceSnapshot = null;
      if (amount <= 0n) {
        // No agreed amount: price from the live (or manual) BUY price.
        const deduction = v.body.deductionMilyem ? parseDecimal(v.body.deductionMilyem, SCALE.MILYEM, { field: 'Fire düşümü' }) : 0n;
        const prices = await resolveMetalPrices([metal], 'buy', { manualPrices: v.body.manualPricePerGram ? { [metal]: v.body.manualPricePerGram } : {} });
        amount = priceMetalPurchase({ weightMg, purity, pricePerGram: prices[metal].pricePerGram, deductionMilyem: deduction }).amountMinor;
        priceSnapshot = prices[metal];
      }
      if (amount <= 0n) throw badRequest('Hurda alım tutarı pozitif olmalıdır');
      const toAccount = cust && v.method === 'cari';
      if (!toAccount && !tryAcct) throw badRequest('Ödeme yöntemi seçilmelidir');
      entryType = 'scrap_purchase';
      lines.push(debit(ACCOUNTS.inventory(b), 'TRY', amount));
      lines.push(toAccount ? credit(ACCOUNTS.receivable(cust), 'TRY', amount, { customerId: cust }) : credit(tryAcct, 'TRY', amount));
      return { entryType, lines, scrap: { metal, purity, weightMg, fineMg, amount, priceSnapshot } };
    }
    default:
      throw badRequest('Bu işlem türü bu uç noktada desteklenmiyor');
  }
  return { entryType, lines };
}

function creates(ctx, v, plan, { journalEntryId, customer, supplier }) {
  return {
    businessId: ctx.businessId,
    branch: ctx.branch,
    customerId: customer ? customer._id : undefined,
    supplierId: supplier ? supplier._id : undefined,
    type: v.type,
    paymentMethod: v.method,
    direction: v.body.direction && v.type === 'devir' ? v.body.direction : null,
    amountTry: plan.scrap ? money(plan.scrap.amount) : money(v.amountTryMinor),
    amountGoldGrams: plan.scrap ? grams(plan.scrap.fineMg) : grams(v.amountGoldMg),
    amountTryMinor: toSafeInteger(plan.scrap ? plan.scrap.amount : v.amountTryMinor),
    amountGoldMg: toSafeInteger(plan.scrap ? plan.scrap.fineMg : v.amountGoldMg),
    ...(plan.scrap ? { weightMg: toSafeInteger(plan.scrap.weightMg), purity: Number(plan.scrap.purity), fineMg: toSafeInteger(plan.scrap.fineMg) } : {}),
    expenseCategory: v.type === 'gider' ? sanitizeCategory(v.body.expenseCategory) : undefined,
    description: v.description,
    handledBy: ctx.userId || undefined,
    journalEntryId,
    date: new Date(),
  };
}

/**
 * POST /api/cash/transactions — one voucher, one transaction.
 * satis_tahsilati (payment against a specific sale) is delegated to the
 * sales service by the route.
 */
async function createVoucher(ctx, body, options = {}) {
  let v;
  let plan;
  try {
    v = parseVoucher(body);
    if (v.type === 'satis_tahsilati') throw badRequest('Satış tahsilatı için saleId ile /api/sales/:id/payments kullanılır');
    plan = await planVoucher(ctx, v);
  } catch (error) {
    throw wrap(error);
  }
  // Parties are validated inside the tenant before any account is created for them.
  if (v.customerId && !(await Customer.exists({ _id: v.customerId, businessId: ctx.businessId }))) {
    throw notFound('Müşteri bulunamadı', 'CUSTOMER_NOT_FOUND');
  }
  if (v.supplierId && !(await Supplier.exists({ _id: v.supplierId, businessId: ctx.businessId }))) {
    throw notFound('Tedarikçi bulunamadı', 'SUPPLIER_NOT_FOUND');
  }
  // A card collection (tahsilat) is a POS capture: commission + POS sub-ledger.
  const cardPayments = v.type === 'tahsilat' && v.method === 'kredi kartı' && v.amountTryMinor > 0n
    ? [{ method: v.method, amountMinor: v.amountTryMinor, pos: body.pos }]
    : [];
  const cardPlan = await pos.planPayments(ctx, ctx.branch, cardPayments);
  await ledger.prepareAccounts(ctx.businessId, [...ledger.accountsOf(plan.lines), ...cardPlan.accounts]);
  if (plan.scrap) await inventory.prepareMetalPool(ctx, { branch: ctx.branch, metal: plan.scrap.metal, purity: plan.scrap.purity });

  try {
    return await runInTransaction(async (session) => {
      const customer = v.customerId ? await loadCustomer(session, ctx, v.customerId) : null;
      const supplier = v.supplierId ? await loadSupplier(session, ctx, v.supplierId) : null;
      const voucher = new CashTransaction(creates(ctx, v, plan, { customer, supplier }));
      const reference = { kind: 'CashTransaction', id: String(voucher._id) };
      if (plan.scrap) {
        await inventory.moveMetal(session, ctx, {
          metal: plan.scrap.metal, purity: plan.scrap.purity, weightMg: plan.scrap.weightMg, fineMg: plan.scrap.fineMg,
          costMinor: plan.scrap.amount, movementType: 'scrap_purchase', reference,
          reason: plan.scrap.priceSnapshot ? `${plan.scrap.priceSnapshot.priceType} ${plan.scrap.priceSnapshot.pricePerGramText} TL/g` : 'anlaşmalı tutar',
        });
      }
      const entry = await ledger.postEntry(session, ctx, {
        entryType: plan.entryType, lines: plan.lines, reference, description: v.description || `Kasa fişi: ${v.type}`,
      });
      voucher.journalEntryId = entry._id;
      if (cardPayments.length) {
        await pos.recordCaptures(session, ctx, {
          branch: ctx.branch, payments: cardPayments, plans: cardPlan.plans, reference, source: 'tahsilat', journalEntryId: entry._id,
        });
      }

      let allocations = [];
      if (v.type === 'tahsilat' && customer && v.amountTryMinor > 0n) {
        allocations = await allocateCollectionToSales(session, ctx, { customerId: customer._id, amountMinor: v.amountTryMinor, method: v.method, journalEntryId: entry._id });
      } else if (v.type === 'tediye' && supplier) {
        allocations = await allocateSupplierPayment(session, ctx, { supplierId: supplier._id, amountMinor: v.amountTryMinor, method: v.method, journalEntryId: entry._id });
      }

      if (customer) {
        const fresh = await Customer.findOne({ _id: customer._id, businessId: ctx.businessId }).session(session).lean();
        voucher.balanceAfterTry = fresh.balanceTry;
        voucher.balanceAfterGold = fresh.balanceGold;
      } else if (supplier) {
        const fresh = await Supplier.findOne({ _id: supplier._id, businessId: ctx.businessId }).session(session).lean();
        voucher.balanceAfterTry = money(fresh.balanceTryMinor);
      }
      await voucher.save({ session });
      if (options.idempotency) await options.idempotency.remember(session, { resourceType: 'CashTransaction', resourceId: voucher._id, statusCode: 201 });
      if (ctx.userId) {
        await recordAudit({
          AuditLog,
          session,
          actorUserId: ctx.userId,
          action: 'cash.transaction_created',
          resourceType: 'CashTransaction',
          resourceId: String(voucher._id),
          correlationId: ctx.correlationId,
          after: {
            type: v.type,
            amountTry: voucher.amountTry,
            amountGoldGrams: voucher.amountGoldGrams,
            customerId: customer ? customer._id : null,
            supplierId: supplier ? supplier._id : null,
            journalEntryId: String(entry._id),
          },
        });
      }
      return { voucher, allocations };
    });
  } catch (error) {
    throw wrap(error);
  }
}

/* -------------------------------------------------------- cash register */

function resolveBranch(ctx, requested) {
  if (requested && ctx.isAdmin) return String(requested);
  return ctx.branch;
}

/**
 * Like resolveBranch, for writes: an admin's explicit branch must be an
 * active branch of the business. A non-admin naming another branch is
 * refused (403 BRANCH_MISMATCH, as for POS settlements) — silently using
 * their own branch instead would close and lock the wrong drawer.
 */
async function resolveWriteBranch(ctx, requested) {
  if (requested === undefined || requested === null || requested === '') return ctx.branch;
  if (typeof requested !== 'string') throw badRequest('branch bir metin olmalıdır', 'INVALID_BRANCH');
  if (requested.trim() === ctx.branch) return ctx.branch;
  if (!ctx.isAdmin) throw forbidden('Yalnızca kendi şubenizin gün sonunu kapatabilirsiniz', 'BRANCH_MISMATCH');
  return assertBranch(ctx.businessId, requested);
}

/** Per-entry-type debit/credit totals of an account within [start, end). */
async function movementsByType(businessId, account, unit, start, end, session) {
  const aggregate = LedgerEntry.aggregate([
    { $match: { businessId, 'lines.account': account, date: { $gte: start, $lt: end } } },
    { $unwind: '$lines' },
    { $match: { 'lines.account': account, 'lines.unit': unit } },
    { $group: { _id: '$entryType', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
  if (session) aggregate.session(session);
  const rows = await aggregate;
  return Object.fromEntries(rows.map((r) => [r._id, { debit: BigInt(r.debit), credit: BigInt(r.credit) }]));
}

const sumOf = (byType, side, types) => Object.entries(byType)
  .filter(([t]) => !types || types.includes(t))
  .reduce((s, [, v]) => s + v[side], 0n);

async function dailySummary(ctx, { branch: requestedBranch, session } = {}) {
  const branch = resolveBranch(ctx, requestedBranch);
  const date = localDateString();
  const { start, end } = localDayRange(date);
  const cash = ACCOUNTS.cash(branch);
  // Sequential: operations of one transaction session must not run concurrently.
  const openingCash = await ledger.journalBalance(ctx.businessId, cash, 'TRY', { to: start, session });
  const cashByType = await movementsByType(ctx.businessId, cash, 'TRY', start, end, session);
  const cardByType = await movementsByType(ctx.businessId, ACCOUNTS.card(branch), 'TRY', start, end, session);
  const transferByType = await movementsByType(ctx.businessId, ACCOUNTS.transfer(branch), 'TRY', start, end, session);
  const goldBalance = await ledger.journalBalance(ctx.businessId, ACCOUNTS.goldTill(branch), 'XAU', { to: end, session });
  const closingQuery = DailyClosing.findOne({ businessId: ctx.businessId, branch, date }).populate('closedBy', 'name').lean();
  if (session) closingQuery.session(session);
  const closing = await closingQuery;
  const salesQuery = Sale.find({ businessId: ctx.businessId, branch, date: { $gte: start, $lt: end }, status: { $ne: 'cancelled' } })
    .select('totalMinor returnedMinor totalPrice').lean();
  if (session) salesQuery.session(session);
  const sales = await salesQuery;

  const saleTypes = ['sale_payment'];
  const cashIn = sumOf(cashByType, 'debit');
  const cashOut = sumOf(cashByType, 'credit');
  const salesNet = sales.reduce((s, sale) => s + (sale.totalMinor !== undefined && sale.totalMinor !== null
    ? BigInt(sale.totalMinor) - BigInt(sale.returnedMinor || 0)
    : parseDecimal(sale.totalPrice || 0, 2, { round: true })), 0n);

  return {
    date,
    branch,
    salesCount: sales.length,
    totalSalesTry: money(salesNet),
    cashSalesTry: money(sumOf(cashByType, 'debit', saleTypes)),
    posSalesTry: money(sumOf(cardByType, 'debit', saleTypes)),
    transferSalesTry: money(sumOf(transferByType, 'debit', saleTypes)),
    openingCashTry: money(openingCash),
    collectionsTry: money(sumOf(cashByType, 'debit', ['collection', 'cash_opening'])),
    paymentsTry: money(cashOut),
    refundsTry: money(sumOf(cashByType, 'credit', ['sale_refund', 'sale_cancel'])),
    expensesTry: money(sumOf(cashByType, 'credit', ['expense'])),
    scrapPurchasesTry: money(sumOf(cashByType, 'credit', ['scrap_purchase'])),
    cashInTry: money(cashIn),
    cashOutTry: money(cashOut),
    calculatedCash: money(openingCash + cashIn - cashOut),
    calculatedGold: grams(goldBalance),
    closing,
  };
}

/** POST /api/cash/daily-closing — locks today's cash register for the branch. */
async function closeDay(ctx, body = {}) {
  let actualCash;
  let actualGold;
  // Gold is reconciled only when it was actually counted (field present).
  const goldCounted = body.closingGoldActual !== undefined && body.closingGoldActual !== null && body.closingGoldActual !== '';
  try {
    actualCash = parseDecimal(body.closingCashActual, SCALE.MONEY, { field: 'Sayılan nakit', max: LIMITS.MAX_MONEY_MINOR });
    actualGold = optionalAmount(body.closingGoldActual, SCALE.WEIGHT, 'Sayılan has altın', LIMITS.MAX_WEIGHT_MG);
  } catch (error) {
    throw wrap(error);
  }
  // A typo must not create a closing (and a cash difference entry) for a branch that does not exist.
  const branch = await resolveWriteBranch(ctx, body.branch);
  const branchCtx = { ...ctx, branch };
  const cash = ACCOUNTS.cash(branch);
  const vault = ACCOUNTS.goldTill(branch);
  await ledger.prepareAccounts(ctx.businessId, [
    { account: cash, unit: 'TRY' },
    { account: ACCOUNTS.cashOverShort, unit: 'TRY' },
    ...(goldCounted ? [{ account: vault, unit: 'XAU' }, { account: ACCOUNTS.goldOverShort, unit: 'XAU' }] : []),
  ]);
  const date = localDateString();

  return runInTransaction(async (session) => {
    const existing = await DailyClosing.findOne({ businessId: ctx.businessId, branch, date }).session(session);
    if (existing?.isClosed) throw conflict('Bu şubenin bugünkü kasası zaten kapatılmış (Z raporu kilitli)', 'DAY_ALREADY_CLOSED');

    const summary = await dailySummary(branchCtx, { session });
    const calculated = parseDecimal(summary.calculatedCash, SCALE.MONEY);
    const difference = actualCash - calculated;
    let differenceEntry = null;
    if (difference !== 0n) {
      differenceEntry = await ledger.postEntry(session, branchCtx, {
        entryType: 'cash_count_difference',
        reference: { kind: 'DailyClosing', id: `${branch}|${date}` },
        description: `Kasa sayım farkı ${date}`,
        lines: difference > 0n
          ? [debit(cash, 'TRY', difference), credit(ACCOUNTS.cashOverShort, 'TRY', difference)]
          : [debit(ACCOUNTS.cashOverShort, 'TRY', -difference), credit(cash, 'TRY', -difference)],
      });
    }
    // Lock: concurrent cash postings update this same document and conflict.
    const locked = await AccountBalance.updateOne(
      { _id: AccountBalance.idFor(ctx.businessId, cash, 'TRY'), closedDate: { $ne: date } },
      { $set: { closedDate: date } },
      { session },
    );
    if (locked.matchedCount !== 1) throw conflict('Bu şubenin bugünkü kasası zaten kapatılmış', 'DAY_ALREADY_CLOSED');

    const calculatedGold = parseDecimal(summary.calculatedGold, SCALE.WEIGHT);
    let goldDifferenceEntry = null;
    if (goldCounted) {
      // Counted gold is certified like counted cash: the difference is posted
      // (gold_over_short, XAU) so the ledger gold till equals the count, and
      // the till is locked for the rest of the day together with the drawer.
      const goldDifference = actualGold - calculatedGold;
      if (goldDifference !== 0n) {
        goldDifferenceEntry = await ledger.postEntry(session, branchCtx, {
          entryType: 'gold_count_difference',
          reference: { kind: 'DailyClosing', id: `${branch}|${date}|XAU` },
          description: `Altın kasası sayım farkı ${date}`,
          lines: goldDifference > 0n
            ? [debit(vault, 'XAU', goldDifference), credit(ACCOUNTS.goldOverShort, 'XAU', goldDifference)]
            : [debit(ACCOUNTS.goldOverShort, 'XAU', -goldDifference), credit(vault, 'XAU', -goldDifference)],
        });
      }
      const goldLocked = await AccountBalance.updateOne(
        { _id: AccountBalance.idFor(ctx.businessId, vault, 'XAU'), closedDate: { $ne: date } },
        { $set: { closedDate: date } },
        { session },
      );
      if (goldLocked.matchedCount !== 1) throw conflict('Bu şubenin bugünkü altın kasası zaten kapatılmış', 'DAY_ALREADY_CLOSED');
    }
    const doc = {
      businessId: ctx.businessId,
      branch,
      date,
      openingCashTry: summary.openingCashTry,
      totalSalesTry: summary.totalSalesTry,
      totalSalesCount: summary.salesCount,
      totalCollectionsTry: summary.collectionsTry,
      totalPaymentsTry: summary.paymentsTry,
      closingCashCalculated: money(calculated),
      closingCashActual: money(actualCash),
      cashDifference: money(difference),
      closingCashCalculatedMinor: toSafeInteger(calculated),
      closingCashActualMinor: toSafeInteger(actualCash),
      closingGoldCalculated: grams(calculatedGold),
      closingGoldActual: grams(actualGold),
      goldDifference: grams(actualGold - calculatedGold),
      differenceJournalEntryId: differenceEntry ? differenceEntry._id : undefined,
      goldDifferenceJournalEntryId: goldDifferenceEntry ? goldDifferenceEntry._id : undefined,
      goldCounted,
      isClosed: true,
      closedAt: new Date(),
      closedBy: ctx.userId || undefined,
      notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : '',
    };
    let closing;
    if (existing) {
      existing.set(doc);
      closing = await existing.save({ session });
    } else {
      [closing] = await DailyClosing.create([doc], { session });
    }
    if (ctx.userId) {
      await recordAudit({
        AuditLog,
        session,
        actorUserId: ctx.userId,
        action: 'cash.daily_closing',
        resourceType: 'DailyClosing',
        resourceId: String(closing._id),
        correlationId: ctx.correlationId,
        after: {
          date, branch, closingCashCalculated: closing.closingCashCalculated, closingCashActual: closing.closingCashActual, cashDifference: closing.cashDifference,
        },
      });
    }
    return closing;
  });
}

/* ------------------------------------------------------------ statements */

/**
 * Statement rows. direction follows the accounting convention of the
 * party's account: borç = debit (customer: sale / we paid out; supplier:
 * we paid), alacak = credit (customer paid; supplier delivered goods).
 * balanceAfter* use the party convention: positive = the business owes the
 * party, negative = the party owes the business.
 */
function statementRows(rows) {
  return rows.map(({ entry, deltas, balances }) => {
    const tryDelta = deltas.TRY || 0n;
    const goldDelta = deltas.XAU || 0n;
    const primary = tryDelta !== 0n ? tryDelta : goldDelta;
    return {
      id: String(entry._id),
      type: entry.entryType,
      title: entry.description || entry.entryType,
      reference: entry.reference,
      date: entry.date,
      amountTry: money(tryDelta < 0n ? -tryDelta : tryDelta),
      amountGold: grams(goldDelta < 0n ? -goldDelta : goldDelta),
      direction: primary > 0n ? 'borc' : 'alacak',
      reversal: Boolean(entry.reversalOf),
      balanceAfterTry: money(-(balances.TRY || 0n)),
      balanceAfterGold: grams(-(balances.XAU || 0n)),
    };
  });
}

async function customerStatement(ctx, customerId) {
  const id = parseNumericId(customerId, 'müşteri');
  const customer = await Customer.findOne({ _id: id, businessId: ctx.businessId });
  if (!customer) throw notFound('Müşteri bulunamadı', 'CUSTOMER_NOT_FOUND');
  const { rows, closing } = await ledger.accountStatement(ctx.businessId, ACCOUNTS.receivable(id), { units: ['TRY', 'XAU'] });
  const legacyHistory = await Sale.exists({ businessId: ctx.businessId, customerId: id, totalMinor: { $exists: false } });
  return {
    customer,
    // Credit-positive convention (see Customer model).
    balanceTry: money(-(closing.TRY || 0n)),
    balanceGold: grams(-(closing.XAU || 0n)),
    entries: statementRows(rows).reverse(),
    legacyHistory: Boolean(legacyHistory),
  };
}

async function supplierStatement(ctx, supplierId) {
  const id = parseNumericId(supplierId, 'tedarikçi');
  const supplier = await Supplier.findOne({ _id: id, businessId: ctx.businessId }).lean();
  if (!supplier) throw notFound('Tedarikçi bulunamadı', 'SUPPLIER_NOT_FOUND');
  const { rows, closing } = await ledger.accountStatement(ctx.businessId, ACCOUNTS.payable(id), { units: ['TRY'] });
  return {
    supplier: { ...supplier, balanceTry: money(supplier.balanceTryMinor || 0) },
    // Positive = we owe the supplier.
    balanceTry: money(-(closing.TRY || 0n)),
    entries: statementRows(rows).reverse(),
  };
}

module.exports = {
  TYPES,
  parseVoucher,
  createVoucher,
  dailySummary,
  closeDay,
  customerStatement,
  supplierStatement,
};
