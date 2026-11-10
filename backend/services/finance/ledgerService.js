/**
 * Double-entry ledger service.
 *
 * Chart of accounts (account codes; `{x}` = parameter):
 *   cash:{branch}               Kasa (nakit)                       TRY
 *   bank:{branch}:card          POS / kredi kartı alacağı           TRY
 *   bank:{branch}:transfer      Banka (havale/EFT)                 TRY
 *   vault:{branch}              Altın kasası (has gold till)       XAU
 *   ar:{customerId}             Müşteri cari (alacak hesabı)       TRY, XAU
 *   ap:{supplierId}             Tedarikçi cari (borç hesabı)       TRY
 *   inventory:{branch}          Stok (maliyet değeri)              TRY
 *   revenue:sales               Satış gelirleri                    TRY
 *   revenue:returns             Satış iadeleri (contra-gelir)       TRY
 *   cogs                        Satılan malın maliyeti             TRY
 *   expense:{category}          Giderler                           TRY
 *   inventory_adjustment        Sayım farkı (stok)                 TRY
 *   cash_over_short             Kasa farkı                         TRY
 *   gold_over_short             Altın kasası sayım farkı            XAU
 *   equity:opening              Açılış / devir                     TRY, XAU
 *   equity:revaluation          Maliyet düzeltmesi                 TRY
 *   inventory_transit           Yoldaki stok (şubeler arası)       TRY
 *   expense:transfer_loss       Transfer kaybı / fire              TRY
 *   expense:pos_commission      POS / banka komisyonu              TRY
 *   pos_settlement_difference   POS hesap kesim farkı              TRY
 *   purchase_return_variance    Alış iadesi maliyet farkı          TRY
 *   purchase_price_adjustment   Alış fiyat farkı (tedarikçi alacak dekontu) TRY
 *   tax:vat_payable             Hesaplanan KDV (devlete borç)       TRY
 *
 * Card payments: bank:{branch}:card is the receivable from the POS
 * provider/bank. It is debited with the gross amount; the commission of the
 * transaction is moved to expense:pos_commission at capture time, so the
 * account carries the NET amount the bank owes until it is settled.
 *
 * balance = Σ debit − Σ credit. Every posting, its balance projections and
 * the customer/supplier balance fields are written in ONE transaction.
 */
const AccountBalance = require('../../models/AccountBalance');
const LedgerEntry = require('../../models/LedgerEntry');
const Customer = require('../../models/Customer');
const Supplier = require('../../models/Supplier');
const { toSafeInteger } = require('../../domain/decimal');
const { localDateString } = require('../../utils/timeZone');
const { badRequest, conflict, notFound, DomainError } = require('./core');

const PAYMENT_METHODS = Object.freeze(['nakit', 'kredi kartı', 'havale']);

const ACCOUNTS = Object.freeze({
  cash: (branch) => `cash:${branch}`,
  card: (branch) => `bank:${branch}:card`,
  transfer: (branch) => `bank:${branch}:transfer`,
  goldTill: (branch) => `vault:${branch}`,
  receivable: (customerId) => `ar:${customerId}`,
  payable: (supplierId) => `ap:${supplierId}`,
  inventory: (branch) => `inventory:${branch}`,
  revenue: 'revenue:sales',
  salesReturns: 'revenue:returns',
  cogs: 'cogs',
  expense: (category) => `expense:${category || 'genel'}`,
  inventoryAdjustment: 'inventory_adjustment',
  cashOverShort: 'cash_over_short',
  goldOverShort: 'gold_over_short',
  openingEquity: 'equity:opening',
  revaluation: 'equity:revaluation',
  inventoryInTransit: 'inventory_transit',
  transferLoss: 'expense:transfer_loss',
  posCommission: 'expense:pos_commission',
  posSettlementDifference: 'pos_settlement_difference',
  purchaseReturnVariance: 'purchase_return_variance',
  purchasePriceAdjustment: 'purchase_price_adjustment',
  vatPayable: 'tax:vat_payable',
});

/** Ledger account receiving money paid with `method` in `branch`. */
function paymentAccount(branch, method) {
  if (method === 'nakit') return ACCOUNTS.cash(branch);
  if (method === 'kredi kartı') return ACCOUNTS.card(branch);
  if (method === 'havale') return ACCOUNTS.transfer(branch);
  throw badRequest(`Geçersiz ödeme yöntemi: ${method}`, 'INVALID_PAYMENT_METHOD');
}

const isCashAccount = (account) => account.startsWith('cash:');
const isGoldTill = (account) => account.startsWith('vault:');
/** Accounts frozen by a daily closing (closedDate === today): the drawer and, once counted, the gold till. */
const isDayLocked = (account) => isCashAccount(account) || isGoldTill(account);

/** Line helpers; amounts are BigInt or safe integers (minor units). */
const debit = (account, unit, amount, extra = {}) => ({ account, unit, debit: amount, credit: 0n, ...extra });
const credit = (account, unit, amount, extra = {}) => ({ account, unit, debit: 0n, credit: amount, ...extra });

function normalizeLines(lines) {
  return lines
    .map((line) => {
      const d = BigInt(line.debit || 0);
      const c = BigInt(line.credit || 0);
      if (d < 0n || c < 0n) throw new Error('Ledger line amounts must not be negative');
      return { ...line, debit: d, credit: c };
    })
    .filter((line) => line.debit !== 0n || line.credit !== 0n);
}

function assertBalanced(lines) {
  const totals = new Map();
  for (const line of lines) {
    const t = totals.get(line.unit) || { d: 0n, c: 0n };
    t.d += line.debit;
    t.c += line.credit;
    totals.set(line.unit, t);
  }
  for (const [unit, t] of totals) {
    if (t.d !== t.c) throw new Error(`Unbalanced ledger entry in ${unit}: debit ${t.d} ≠ credit ${t.c}`);
  }
}

/**
 * Creates the balance documents for `accounts` outside the transaction
 * (two transactions upserting the same new document would fail with a
 * non-retryable duplicate key instead of a retryable write conflict).
 */
async function prepareAccounts(businessId, accounts) {
  const unique = new Map();
  for (const { account, unit } of accounts) unique.set(AccountBalance.idFor(businessId, account, unit), { account, unit });
  await Promise.all([...unique.entries()].map(async ([_id, { account, unit }]) => {
    try {
      await AccountBalance.updateOne(
        { _id },
        { $setOnInsert: { businessId, account, unit, debit: 0, credit: 0, closedDate: null, lastPostedAt: null } },
        { upsert: true },
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }));
}

/** Convenience: prepare every account referenced by line templates. */
function accountsOf(lines) {
  return lines.map(({ account, unit }) => ({ account, unit }));
}

async function applyBalance(session, ctx, line, today, now) {
  const _id = AccountBalance.idFor(ctx.businessId, line.account, line.unit);
  const filter = { _id };
  if (isDayLocked(line.account)) filter.closedDate = { $ne: today };
  if (isGoldTill(line.account) && line.credit > 0n) {
    // Physical gold cannot leave a till that does not hold it.
    filter.$expr = { $gte: [{ $subtract: ['$debit', '$credit'] }, toSafeInteger(line.credit)] };
  }
  const result = await AccountBalance.updateOne(filter, {
    $inc: { debit: toSafeInteger(line.debit), credit: toSafeInteger(line.credit) },
    $set: { lastPostedAt: now },
  }, { session });
  if (result.matchedCount === 1) return;

  const existing = await AccountBalance.findById(_id).session(session).lean();
  if (!existing) throw new Error(`Ledger account not prepared: ${line.account} (${line.unit})`);
  if (isDayLocked(line.account) && existing.closedDate === today) {
    throw conflict('Bu şube için bugünün kasası (Z raporu) kapatılmış; yeni kasa hareketi kaydedilemez.', 'CASH_DAY_CLOSED');
  }
  if (isGoldTill(line.account)) {
    throw conflict('Altın kasasında yeterli has altın bulunmuyor.', 'INSUFFICIENT_GOLD_TILL');
  }
  throw new Error(`Ledger balance update failed for ${line.account}`);
}

/** Applies a delta to the customer's / supplier's balance projection. */
async function applyPartyProjections(session, ctx, lines) {
  const customerDeltas = new Map(); // customerId → { TRY, XAU }
  const supplierDeltas = new Map();
  for (const line of lines) {
    if (line.account.startsWith('ar:')) {
      const id = Number(line.account.slice(3));
      const d = customerDeltas.get(id) || { TRY: 0n, XAU: 0n };
      // AR is debit-normal (customer owes us); balance fields are credit-positive.
      d[line.unit] = (d[line.unit] || 0n) + line.credit - line.debit;
      customerDeltas.set(id, d);
    } else if (line.account.startsWith('ap:')) {
      const id = Number(line.account.slice(3));
      // AP is credit-normal: positive balance = we owe the supplier.
      supplierDeltas.set(id, (supplierDeltas.get(id) || 0n) + line.credit - line.debit);
    }
  }

  for (const [customerId, delta] of customerDeltas) {
    const tryDelta = toSafeInteger(delta.TRY || 0n);
    const goldDelta = toSafeInteger(delta.XAU || 0n);
    // Pipeline update: exact integer projection and its display value in one atomic write.
    const result = await Customer.updateOne(
      { _id: customerId, businessId: ctx.businessId },
      [
        { $set: {
          balanceTryMinor: { $add: [{ $ifNull: ['$balanceTryMinor', 0] }, tryDelta] },
          balanceGoldMg: { $add: [{ $ifNull: ['$balanceGoldMg', 0] }, goldDelta] },
        } },
        { $set: {
          balanceTry: { $divide: ['$balanceTryMinor', 100] },
          balanceGold: { $divide: ['$balanceGoldMg', 1000] },
        } },
      ],
      { session },
    );
    if (result.matchedCount !== 1) throw notFound('Müşteri bulunamadı', 'CUSTOMER_NOT_FOUND');
  }
  for (const [supplierId, delta] of supplierDeltas) {
    const result = await Supplier.updateOne(
      { _id: supplierId, businessId: ctx.businessId },
      { $inc: { balanceTryMinor: toSafeInteger(delta) } },
      { session },
    );
    if (result.matchedCount !== 1) throw notFound('Tedarikçi bulunamadı', 'SUPPLIER_NOT_FOUND');
  }
}

/**
 * Posts one balanced journal entry inside `session`.
 * Accounts must have been prepared (prepareAccounts) before the transaction.
 */
async function postEntry(session, ctx, {
  entryType, lines, description, reference, date = new Date(), externalKey, reversalOf = null, branch,
  // false only for the start-up migration, whose entries document balances
  // that the customer/supplier documents already contain.
  projectParties = true,
}) {
  const normalized = normalizeLines(lines);
  if (normalized.length < 2) throw new Error('A ledger entry needs at least two non-zero lines');
  assertBalanced(normalized);
  const now = new Date();
  const today = localDateString(now);
  for (const line of normalized) {
    // Sequential on purpose: one session cannot run operations in parallel.
    await applyBalance(session, ctx, line, today, now);
  }
  if (projectParties) await applyPartyProjections(session, ctx, normalized);

  const [entry] = await LedgerEntry.create([{
    businessId: ctx.businessId,
    branch: branch || ctx.branch,
    entryType,
    date,
    description,
    reference,
    lines: normalized.map((line) => ({
      account: line.account,
      unit: line.unit,
      debit: toSafeInteger(line.debit),
      credit: toSafeInteger(line.credit),
      ...(line.customerId !== undefined ? { customerId: line.customerId } : {}),
      ...(line.supplierId !== undefined ? { supplierId: line.supplierId } : {}),
      ...(line.memo ? { memo: line.memo } : {}),
    })),
    reversalOf,
    externalKey,
    createdBy: ctx.userId || null,
    correlationId: ctx.correlationId,
  }], { session });
  return entry;
}

/** Posts the exact mirror of `entryId` and links both entries (once). */
async function reverseEntry(session, ctx, entryId, { entryType, description, reference }) {
  const original = await LedgerEntry.findOne({ _id: entryId, businessId: ctx.businessId }).session(session);
  if (!original) throw notFound('Muhasebe kaydı bulunamadı', 'LEDGER_ENTRY_NOT_FOUND');
  if (original.reversedBy) throw conflict('Bu muhasebe kaydı zaten ters kayıtla kapatılmış', 'ALREADY_REVERSED');
  const mirror = original.lines.map((line) => ({
    account: line.account,
    unit: line.unit,
    debit: BigInt(line.credit),
    credit: BigInt(line.debit),
    customerId: line.customerId,
    supplierId: line.supplierId,
  }));
  const reversal = await postEntry(session, ctx, {
    entryType, lines: mirror, description, reference: reference || original.reference, reversalOf: original._id, branch: original.branch,
  });
  const linked = await LedgerEntry.updateOne(
    { _id: original._id, businessId: ctx.businessId, reversedBy: null },
    { $set: { reversedBy: reversal._id } },
    { session },
  );
  if (linked.modifiedCount !== 1) throw conflict('Bu muhasebe kaydı başka bir işlemle ters kayda alındı', 'ALREADY_REVERSED');
  return reversal;
}

/** Current balance (debit − credit) of an account as BigInt. */
async function balanceOf(businessId, account, unit, { session } = {}) {
  const query = AccountBalance.findById(AccountBalance.idFor(businessId, account, unit)).lean();
  if (session) query.session(session);
  const doc = await query;
  return doc ? BigInt(doc.debit) - BigInt(doc.credit) : 0n;
}

/**
 * Σ debit − Σ credit of an account from the JOURNAL in [from, to).
 * Used for statements and the cash register (not the projection).
 */
async function journalBalance(businessId, account, unit, { from, to, session } = {}) {
  const match = { businessId, 'lines.account': account };
  if (from || to) match.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  const pipeline = [
    { $match: match },
    { $unwind: '$lines' },
    { $match: { 'lines.account': account, 'lines.unit': unit } },
    { $group: { _id: null, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ];
  const aggregate = LedgerEntry.aggregate(pipeline);
  if (session) aggregate.session(session);
  const [row] = await aggregate;
  return row ? BigInt(row.debit) - BigInt(row.credit) : 0n;
}

/**
 * Chronological lines of one account with a running balance.
 * Shows the most recent `limit` entries; the closing balance always comes
 * from the FULL journal and the window's opening balance is derived from it,
 * so a long history can never produce a wrong balance (only a shorter list).
 */
async function accountStatement(businessId, account, { units = ['TRY'], from, to, limit = 1000 } = {}) {
  const match = { businessId, 'lines.account': account };
  if (from || to) match.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  const newestFirst = await LedgerEntry.find(match).sort({ date: -1, _id: -1 }).limit(limit + 1).lean();
  const truncated = newestFirst.length > limit;
  const entries = newestFirst.slice(0, limit).reverse();

  const deltasOf = (entry) => {
    const deltas = {};
    for (const line of entry.lines) {
      if (line.account !== account || !units.includes(line.unit)) continue;
      deltas[line.unit] = (deltas[line.unit] || 0n) + BigInt(line.debit) - BigInt(line.credit);
    }
    return deltas;
  };
  const windowDeltas = entries.map(deltasOf);
  const closing = {};
  const opening = {};
  for (const unit of units) {
    closing[unit] = await journalBalance(businessId, account, unit, { from, to });
    if (from) {
      closing[unit] += await journalBalance(businessId, account, unit, { to: from });
    }
    opening[unit] = closing[unit] - windowDeltas.reduce((s, d) => s + (d[unit] || 0n), 0n);
  }
  const running = { ...opening };
  const rows = entries.map((entry, i) => {
    for (const [unit, delta] of Object.entries(windowDeltas[i])) running[unit] += delta;
    return { entry, deltas: windowDeltas[i], balances: { ...running } };
  });
  return { rows, closing, opening, truncated };
}

/**
 * Full ledger reconciliation for a business:
 *  1. every journal entry balances per unit
 *  2. every account's projection equals the journal totals
 *  3. customer balance fields equal their receivable accounts
 *  4. supplier balance fields equal their payable accounts
 */
async function reconcile(businessId) {
  const discrepancies = [];

  const unbalanced = await LedgerEntry.aggregate([
    { $match: { businessId } },
    { $unwind: '$lines' },
    { $group: { _id: { entry: '$_id', unit: '$lines.unit' }, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
    { $match: { $expr: { $ne: ['$debit', '$credit'] } } },
    { $limit: 100 },
  ]);
  for (const row of unbalanced) discrepancies.push({ check: 'entry_balanced', entryId: String(row._id.entry), unit: row._id.unit, debit: row.debit, credit: row.credit });

  const journalTotals = await LedgerEntry.aggregate([
    { $match: { businessId } },
    { $unwind: '$lines' },
    { $group: { _id: { account: '$lines.account', unit: '$lines.unit' }, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
  const projections = await AccountBalance.find({ businessId }).lean();
  const projectionById = new Map(projections.map((p) => [`${p.account}|${p.unit}`, p]));
  const journalById = new Map(journalTotals.map((j) => [`${j._id.account}|${j._id.unit}`, j]));
  for (const key of new Set([...projectionById.keys(), ...journalById.keys()])) {
    const p = projectionById.get(key) || { debit: 0, credit: 0 };
    const j = journalById.get(key) || { debit: 0, credit: 0 };
    if (p.debit !== j.debit || p.credit !== j.credit) {
      discrepancies.push({ check: 'account_projection', account: key, projection: { debit: p.debit, credit: p.credit }, journal: { debit: j.debit, credit: j.credit } });
    }
  }

  const accountBalance = (account, unit) => {
    const j = journalById.get(`${account}|${unit}`);
    return j ? BigInt(j.debit) - BigInt(j.credit) : 0n;
  };

  const customers = await Customer.find({ businessId }).select('_id name balanceTryMinor balanceGoldMg').lean();
  for (const c of customers) {
    const expectedTry = -accountBalance(ACCOUNTS.receivable(c._id), 'TRY');
    const expectedGold = -accountBalance(ACCOUNTS.receivable(c._id), 'XAU');
    if (BigInt(c.balanceTryMinor || 0) !== expectedTry || BigInt(c.balanceGoldMg || 0) !== expectedGold) {
      discrepancies.push({
        check: 'customer_balance', customerId: c._id,
        stored: { tryMinor: c.balanceTryMinor || 0, goldMg: c.balanceGoldMg || 0 },
        ledger: { tryMinor: Number(expectedTry), goldMg: Number(expectedGold) },
      });
    }
  }
  const suppliers = await Supplier.find({ businessId }).select('_id balanceTryMinor').lean();
  for (const s of suppliers) {
    const expected = -accountBalance(ACCOUNTS.payable(s._id), 'TRY');
    if (BigInt(s.balanceTryMinor || 0) !== expected) {
      discrepancies.push({ check: 'supplier_balance', supplierId: s._id, stored: s.balanceTryMinor || 0, ledger: Number(expected) });
    }
  }

  // Trial balance: Σ of all balances per unit must be zero.
  const trial = {};
  for (const j of journalTotals) {
    trial[j._id.unit] = (trial[j._id.unit] || 0n) + BigInt(j.debit) - BigInt(j.credit);
  }
  for (const [unit, total] of Object.entries(trial)) {
    if (total !== 0n) discrepancies.push({ check: 'trial_balance', unit, total: Number(total) });
  }

  return {
    ok: discrepancies.length === 0,
    checkedAt: new Date().toISOString(),
    entriesChecked: await LedgerEntry.countDocuments({ businessId }),
    accountsChecked: journalById.size,
    customersChecked: customers.length,
    suppliersChecked: suppliers.length,
    trialBalance: Object.fromEntries(Object.entries(trial).map(([u, v]) => [u, Number(v)])),
    discrepancies,
  };
}

function isDomainError(error) {
  return error instanceof DomainError;
}

module.exports = {
  ACCOUNTS,
  PAYMENT_METHODS,
  paymentAccount,
  debit,
  credit,
  prepareAccounts,
  accountsOf,
  postEntry,
  reverseEntry,
  balanceOf,
  journalBalance,
  accountStatement,
  reconcile,
  isDomainError,
};
