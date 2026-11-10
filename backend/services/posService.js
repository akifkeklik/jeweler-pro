/**
 * Card / POS commission accounting and bank settlement.
 *
 * Capture (card payment in a sale, a sale collection or a tahsilat voucher):
 *   the payment entry debits bank:{branch}:card with the GROSS amount (as before);
 *   in the same transaction this service records a PosTransaction with the
 *   commission rule SNAPSHOT and posts
 *     Dr expense:pos_commission   Cr bank:{branch}:card     (commission)
 *   so the card account carries exactly what the bank owes (net receivable).
 * Refund by card: a negative PosTransaction; the commission is reversed
 *   proportionally only when the provider policy says the bank refunds it.
 * Settlement: a bank deposit matched to open items
 *     Dr bank:{branch}:transfer (deposited)   Cr bank:{branch}:card (expected)
 *   a difference is booked only with an explicit resolution:
 *     commission              → expense:pos_commission
 *     settlement_difference   → pos_settlement_difference
 * A successful POS authorisation never counts as settled.
 *
 * Businesses without any POS provider keep the previous behaviour (gross
 * receivable, commission unknown): their card captures are recorded as
 * unconfigured items, and the commission becomes visible at settlement.
 */
const mongoose = require('mongoose');
const PosProvider = require('../models/PosProvider');
const PosTransaction = require('../models/PosTransaction');
const PosSettlement = require('../models/PosSettlement');
const AuditLog = require('../models/AuditLog');
const { recordAudit } = require('../utils/audit');
const { parseDecimal, toSafeInteger, toDisplayNumber, DecimalError } = require('../domain/decimal');
const { SCALE, LIMITS } = require('../domain/precision');
const {
  parseRatePercent, formatRatePpm, computeCommission, refundCommissionShare, CommissionError,
} = require('../domain/commission');
const ledger = require('./finance/ledgerService');
const { assertBranch } = require('./finance/branchDirectory');
const {
  badRequest, notFound, conflict, unprocessable, forbidden, runInTransaction,
} = require('./finance/core');

const { ACCOUNTS, paymentAccount, debit, credit } = ledger;
const CARD = 'kredi kartı';
const DAY_MS = 24 * 60 * 60 * 1000;
const money = (minor) => toDisplayNumber(BigInt(minor), SCALE.MONEY);

function wrap(error) {
  if (error instanceof DecimalError) return badRequest(error.message, error.code);
  if (error instanceof CommissionError) return unprocessable(error.message, error.code);
  return error;
}

function objectId(value, label) {
  if (typeof value !== 'string' || !mongoose.Types.ObjectId.isValid(value) || String(new mongoose.Types.ObjectId(value)) !== value) {
    throw badRequest(`Geçerli bir ${label} seçilmelidir`, 'INVALID_ID');
  }
  return new mongoose.Types.ObjectId(value);
}

/** Card data must never be stored: reject anything that looks like a card number (PAN). */
function safeReferenceText(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw badRequest(`${field} metin olmalıdır`);
  const text = value.trim().slice(0, 40);
  if (/\d{12,19}/.test(text.replace(/[\s-]/g, ''))) {
    throw badRequest(`${field} kart numarası içeremez; yalnızca terminal / provizyon kodunu girin`, 'CARD_DATA_REJECTED');
  }
  return text;
}

/* ------------------------------------------------------------ providers */

function parseRules(raw) {
  if (!Array.isArray(raw) || !raw.length) throw badRequest('En az bir taksit/komisyon kuralı girilmelidir', 'POS_RULES_REQUIRED');
  if (raw.length > 36) throw badRequest('En fazla 36 kural tanımlanabilir');
  const seen = new Set();
  return raw.map((r) => {
    const installments = Number(r?.installments ?? 1);
    if (!Number.isSafeInteger(installments) || installments < 1 || installments > 36) throw badRequest('Taksit sayısı 1-36 arasında olmalıdır');
    if (seen.has(installments)) throw badRequest(`${installments} taksit için birden fazla kural var`, 'DUPLICATE_POS_RULE');
    seen.add(installments);
    const ratePpm = parseRatePercent(r?.ratePercent ?? '0');
    const fixedFeeMinor = parseDecimal(r?.fixedFee ?? '0', SCALE.MONEY, { field: 'Sabit işlem ücreti', max: 100000000n });
    const valorDays = Number(r?.valorDays ?? 1);
    if (!Number.isSafeInteger(valorDays) || valorDays < 0 || valorDays > 400) throw badRequest('Valör günü 0-400 arasında olmalıdır');
    return { installments, ratePpm: toSafeInteger(ratePpm), fixedFeeMinor: toSafeInteger(fixedFeeMinor), valorDays };
  }).sort((a, b) => a.installments - b.installments);
}

async function parseBranches(ctx, raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw badRequest('branches bir dizi olmalıdır');
  const out = [];
  for (const b of raw) {
    out.push(await assertBranch(ctx.businessId, b));
  }
  return [...new Set(out)];
}

function providerDto(p) {
  const rule = (r) => ({
    installments: r.installments, ratePercent: formatRatePpm(r.ratePpm), fixedFee: money(r.fixedFeeMinor), valorDays: r.valorDays,
  });
  return {
    _id: p._id,
    code: p.code,
    name: p.name,
    branches: p.branches,
    active: p.active,
    refundCommissionPolicy: p.refundCommissionPolicy,
    version: p.version,
    validFrom: p.validFrom,
    rules: (p.rules || []).map(rule),
    history: (p.history || []).map((h) => ({
      version: h.version, validFrom: h.validFrom, validTo: h.validTo, refundCommissionPolicy: h.refundCommissionPolicy, rules: h.rules.map(rule),
    })),
  };
}

async function createProvider(ctx, body) {
  if (!body || typeof body !== 'object') throw badRequest('Geçerli bir POS tanımı gönderilmelidir');
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) throw badRequest('Kod 2-40 karakter, harf/rakam/-/_ olmalıdır', 'INVALID_CODE');
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) throw badRequest('POS / banka adı girilmelidir');
  let rules;
  try {
    rules = parseRules(body.rules);
  } catch (error) {
    throw wrap(error);
  }
  const policy = body.refundCommissionPolicy || 'retained';
  if (!['retained', 'reversed'].includes(policy)) throw badRequest('İade komisyon politikası retained veya reversed olmalıdır');
  const branches = await parseBranches(ctx, body.branches);
  try {
    const provider = await PosProvider.create({
      businessId: ctx.businessId, code, name, branches, rules, refundCommissionPolicy: policy, createdBy: ctx.userId || null, validFrom: new Date(),
    });
    if (ctx.userId) {
      await recordAudit({
        AuditLog, actorUserId: ctx.userId, action: 'pos.provider_created', resourceType: 'PosProvider', resourceId: String(provider._id),
        correlationId: ctx.correlationId, after: { code, name, rules },
      });
    }
    return provider;
  } catch (error) {
    if (error?.code === 11000) throw conflict('Bu kodla bir POS sağlayıcısı zaten var', 'DUPLICATE');
    throw error;
  }
}

/** Changing rules or policy creates a new version; the old one moves to history. */
async function updateProvider(ctx, id, body) {
  const _id = objectId(id, 'POS sağlayıcısı');
  const provider = await PosProvider.findOne({ _id, businessId: ctx.businessId });
  if (!provider) throw notFound('POS sağlayıcısı bulunamadı', 'POS_PROVIDER_NOT_FOUND');
  const before = providerDto(provider);
  if (typeof body?.name === 'string' && body.name.trim()) provider.name = body.name.trim().slice(0, 120);
  if (typeof body?.active === 'boolean') provider.active = body.active;
  if (body?.branches !== undefined) provider.branches = await parseBranches(ctx, body.branches);
  const policy = body?.refundCommissionPolicy;
  if (policy !== undefined && !['retained', 'reversed'].includes(policy)) throw badRequest('İade komisyon politikası retained veya reversed olmalıdır');
  let rules = null;
  if (body?.rules !== undefined) {
    try {
      rules = parseRules(body.rules);
    } catch (error) {
      throw wrap(error);
    }
  }
  const rulesChanged = rules && JSON.stringify(rules) !== JSON.stringify(provider.rules.map((r) => ({
    installments: r.installments, ratePpm: r.ratePpm, fixedFeeMinor: r.fixedFeeMinor, valorDays: r.valorDays,
  })));
  const policyChanged = policy !== undefined && policy !== provider.refundCommissionPolicy;
  if (rulesChanged || policyChanged) {
    const now = new Date();
    provider.history.push({
      version: provider.version, rules: provider.rules, refundCommissionPolicy: provider.refundCommissionPolicy,
      validFrom: provider.validFrom || provider.createdAt, validTo: now, changedBy: ctx.userId || null,
    });
    if (rulesChanged) provider.rules = rules;
    if (policyChanged) provider.refundCommissionPolicy = policy;
    provider.version += 1;
    provider.validFrom = now;
  }
  await provider.save();
  if (ctx.userId) {
    await recordAudit({
      AuditLog, actorUserId: ctx.userId, action: 'pos.provider_updated', resourceType: 'PosProvider', resourceId: String(provider._id),
      correlationId: ctx.correlationId, before, after: providerDto(provider),
    });
  }
  return provider;
}

/* -------------------------------------------------------------- capture */

/** Optional `pos` block of a card payment: { providerId, installments, terminalId, authCode }. */
function parsePosInput(raw) {
  if (raw === undefined || raw === null) return { providerId: null, installments: 1 };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('pos { providerId, installments } biçiminde olmalıdır');
  const installments = raw.installments === undefined || raw.installments === null || raw.installments === '' ? 1 : Number(raw.installments);
  if (!Number.isSafeInteger(installments) || installments < 1 || installments > 36) throw badRequest('Taksit sayısı 1-36 arasında olmalıdır', 'INVALID_INSTALLMENTS');
  return {
    providerId: raw.providerId ? objectId(String(raw.providerId), 'POS sağlayıcısı') : null,
    installments,
    terminalId: safeReferenceText(raw.terminalId, 'Terminal no'),
    authCode: safeReferenceText(raw.authCode, 'Provizyon kodu'),
  };
}

async function activeProviders(businessId, branch) {
  return PosProvider.find({ businessId, active: true, $or: [{ branches: { $size: 0 } }, { branches: branch }] }).lean();
}

/**
 * Resolves the provider and commission rule of one card payment
 * (outside the transaction; the rule is snapshotted from this read).
 */
async function planCard(ctx, branch, input) {
  const providers = await activeProviders(ctx.businessId, branch);
  let provider = null;
  if (input.providerId) {
    provider = providers.find((p) => String(p._id) === String(input.providerId));
    if (!provider) throw unprocessable('Seçilen POS sağlayıcısı bu şubede aktif değil', 'POS_PROVIDER_NOT_FOUND');
  } else if (providers.length === 1) {
    [provider] = providers;
  } else if (providers.length > 1) {
    throw badRequest('Kartlı ödeme için POS sağlayıcısı seçilmelidir', 'POS_PROVIDER_REQUIRED', {
      providers: providers.map((p) => ({ _id: p._id, code: p.code, name: p.name })),
    });
  }
  if (!provider) {
    return { provider: null, rule: null, input, snapshot: { configured: false, ruleVersion: null, ratePpm: 0, fixedFeeMinor: 0, valorDays: null, refundCommissionPolicy: null } };
  }
  const rule = provider.rules.find((r) => r.installments === input.installments);
  if (!rule) {
    throw unprocessable(`${provider.name}: ${input.installments} taksit için komisyon kuralı tanımlı değil`, 'POS_INSTALLMENT_NOT_CONFIGURED', {
      available: provider.rules.map((r) => r.installments),
    });
  }
  return {
    provider,
    rule,
    input,
    snapshot: {
      configured: true,
      ruleVersion: provider.version,
      ratePpm: rule.ratePpm,
      fixedFeeMinor: rule.fixedFeeMinor,
      valorDays: rule.valorDays,
      refundCommissionPolicy: provider.refundCommissionPolicy,
    },
  };
}

/**
 * Plans every card payment of a command. `payments`: [{ method, amountMinor, pos }].
 * Returns { plans (index-aligned, null for non-card), accounts } — accounts
 * must be prepared before the transaction.
 */
async function planPayments(ctx, branch, payments) {
  const plans = [];
  let anyCard = false;
  for (const p of payments) {
    if (p.method !== CARD) {
      plans.push(null);
      continue;
    }
    anyCard = true;
    let input;
    try {
      input = parsePosInput(p.pos);
    } catch (error) {
      throw wrap(error);
    }
    const plan = await planCard(ctx, branch, input);
    plans.push(plan);
  }
  for (let i = 0; i < payments.length; i += 1) {
    if (!plans[i]?.snapshot.configured || payments[i].amountMinor === undefined) continue;
    try {
      computeCommission(payments[i].amountMinor, plans[i].rule); // fail early (e.g. commission > amount)
    } catch (error) {
      throw wrap(error);
    }
  }
  const accounts = anyCard
    ? [{ account: ACCOUNTS.posCommission, unit: 'TRY' }, { account: ACCOUNTS.card(branch), unit: 'TRY' }]
    : [];
  return { plans, accounts };
}

/** Records the PosTransactions (and commission entries) for planned card payments, inside `session`. */
async function recordCaptures(session, ctx, {
  branch, payments, plans, reference, source, journalEntryId,
}) {
  const created = [];
  for (let i = 0; i < payments.length; i += 1) {
    const plan = plans[i];
    if (!plan) continue;
    const gross = BigInt(payments[i].amountMinor);
    let commissionMinor = 0n;
    let netMinor = gross;
    if (plan.snapshot.configured) {
      try {
        ({ commissionMinor, netMinor } = computeCommission(gross, plan.rule));
      } catch (error) {
        throw wrap(error);
      }
    }
    const now = new Date();
    let commissionEntry = null;
    if (commissionMinor > 0n) {
      commissionEntry = await ledger.postEntry(session, ctx, {
        entryType: 'pos_commission',
        reference,
        branch,
        description: `POS komisyonu ${plan.provider.code} (${plan.input.installments} taksit, %${formatRatePpm(plan.rule.ratePpm)}${plan.rule.fixedFeeMinor ? ` + ${money(plan.rule.fixedFeeMinor)} TL` : ''})`,
        lines: [debit(ACCOUNTS.posCommission, 'TRY', commissionMinor), credit(ACCOUNTS.card(branch), 'TRY', commissionMinor)],
      });
    }
    const [doc] = await PosTransaction.create([{
      businessId: ctx.businessId,
      branch,
      providerId: plan.provider ? plan.provider._id : null,
      providerCode: plan.provider ? plan.provider.code : null,
      kind: 'payment',
      source,
      reference,
      installments: plan.input.installments,
      commissionSnapshot: plan.snapshot,
      grossMinor: toSafeInteger(gross),
      commissionMinor: toSafeInteger(commissionMinor),
      netMinor: toSafeInteger(netMinor),
      capturedAt: now,
      expectedSettlementDate: plan.snapshot.valorDays === null ? null : new Date(now.getTime() + plan.snapshot.valorDays * DAY_MS),
      terminalId: plan.input.terminalId,
      authCode: plan.input.authCode,
      paymentJournalEntryId: journalEntryId || null,
      commissionJournalEntryId: commissionEntry ? commissionEntry._id : null,
      createdBy: ctx.userId || null,
      correlationId: ctx.correlationId,
    }], { session });
    created.push(doc);
  }
  return created;
}

/** Accounts to prepare before a card refund transaction. */
function refundAccounts(branch) {
  return [{ account: ACCOUNTS.posCommission, unit: 'TRY' }, { account: ACCOUNTS.card(branch), unit: 'TRY' }];
}

/**
 * Card refund of `grossMinor` against the given original payment
 * transactions (oldest first); any part that cannot be attributed is
 * recorded as an unattributed refund. Inside `session`.
 */
async function recordRefund(session, ctx, {
  branch, grossMinor, originals = [], reference, source, journalEntryId,
  // true when the GL refund was posted to the ORIGINAL payment's card account (cancellation mirror)
  useOriginalBranch = false,
}) {
  let left = BigInt(grossMinor);
  const created = [];
  const refundOne = async (original, part) => {
    const b = useOriginalBranch && original ? original.branch : branch;
    let reversed = 0n;
    const policy = original?.commissionSnapshot?.refundCommissionPolicy;
    if (original && policy === 'reversed' && original.commissionMinor > 0) {
      reversed = refundCommissionShare(original.commissionMinor, original.grossMinor, original.refundedGrossMinor || 0, part);
    }
    if (original) {
      const res = await PosTransaction.updateOne(
        { _id: original._id, businessId: ctx.businessId, refundedGrossMinor: original.refundedGrossMinor || 0 },
        { $inc: { refundedGrossMinor: toSafeInteger(part) } },
        { session },
      );
      if (res.matchedCount !== 1) throw conflict('POS işlemi bu sırada değişti; lütfen tekrar deneyin', 'POS_TRANSACTION_CHANGED');
      original.refundedGrossMinor = (original.refundedGrossMinor || 0) + toSafeInteger(part);
    }
    let reversalEntry = null;
    if (reversed > 0n) {
      reversalEntry = await ledger.postEntry(session, ctx, {
        entryType: 'pos_commission_reversal',
        reference,
        description: `POS komisyon iadesi ${original.providerCode}`,
        branch: b,
        lines: [debit(ACCOUNTS.card(b), 'TRY', reversed), credit(ACCOUNTS.posCommission, 'TRY', reversed)],
      });
    }
    const [doc] = await PosTransaction.create([{
      businessId: ctx.businessId,
      branch: b,
      providerId: original ? original.providerId : null,
      providerCode: original ? original.providerCode : null,
      kind: 'refund',
      source,
      reference,
      installments: original ? original.installments : 1,
      commissionSnapshot: original ? original.commissionSnapshot : { configured: false },
      grossMinor: -toSafeInteger(part),
      commissionMinor: -toSafeInteger(reversed),
      netMinor: -toSafeInteger(part - reversed),
      capturedAt: new Date(),
      expectedSettlementDate: new Date(),
      originalTransactionId: original ? original._id : null,
      paymentJournalEntryId: journalEntryId || null,
      commissionJournalEntryId: reversalEntry ? reversalEntry._id : null,
      createdBy: ctx.userId || null,
      correlationId: ctx.correlationId,
    }], { session });
    created.push(doc);
  };
  for (const original of originals) {
    if (left <= 0n) break;
    const refundable = BigInt(original.grossMinor) - BigInt(original.refundedGrossMinor || 0);
    if (refundable <= 0n) continue;
    const part = refundable < left ? refundable : left;
    await refundOne(original, part);
    left -= part;
  }
  if (left > 0n) await refundOne(null, left);
  return created;
}

/** Card payment transactions of a document (e.g. a sale), oldest first, inside `session`. */
async function paymentsOf(session, ctx, reference, { journalEntryId } = {}) {
  const filter = { businessId: ctx.businessId, kind: 'payment', 'reference.kind': reference.kind, 'reference.id': reference.id };
  if (journalEntryId) filter.paymentJournalEntryId = journalEntryId;
  return PosTransaction.find(filter).sort({ capturedAt: 1, _id: 1 }).session(session).lean();
}

/* ----------------------------------------------------------- settlement */

const openAmount = (t) => BigInt(t.netMinor) - BigInt(t.settledMinor || 0);

function statusFor(net, settled) {
  if (settled === 0n) return 'open';
  return settled === net ? 'settled' : 'partially_settled';
}

/** A ledger line on the debit side for a positive amount, credit side for a negative one. */
const signedLine = (account, amount) => (amount >= 0n ? debit(account, 'TRY', amount) : credit(account, 'TRY', -amount));

/**
 * Settlement direction rules. `expected` = Σ matched open amounts (captures
 * positive, refunds negative); `deposited` = the bank movement, signed:
 *   expected > 0  → the bank pays the merchant:          deposited > 0
 *   expected < 0  → refunds exceed captures, the bank
 *                   debits the merchant's account:       deposited < 0
 *   expected = 0  → refunds and captures net out, no
 *                   money moves:                         deposited = 0
 * A movement in the opposite direction (or money on a netted batch) is never
 * a "difference" to book — it is a wrong match or a wrong sign.
 */
function assertSettlementDirection(expected, deposited) {
  const ok = expected > 0n ? deposited > 0n : expected < 0n ? deposited < 0n : deposited === 0n;
  if (ok) return;
  const required = expected > 0n ? 'pozitif (bankadan yatan)' : expected < 0n ? 'negatif (bankanın hesaptan çektiği)' : 'sıfır (net hareket yok)';
  throw unprocessable(
    `Beklenen net tutar ${money(expected)} TL; banka hareketi ${required} olmalıdır (girilen ${money(deposited)} TL)`,
    'SETTLEMENT_DIRECTION_MISMATCH',
    { expected: money(expected), deposited: money(deposited) },
  );
}

/**
 * payload: { providerId|null, branch?, settlementDate, depositedAmount, bankReference?,
 *            allocations?: [{ posTransactionId, amount? }], differenceResolution?, notes? }
 * depositedAmount is signed (see assertSettlementDirection): a refund-only
 * batch is settled with the negative amount the bank debited, a netted batch
 * with 0.
 */
async function createSettlement(ctx, payload, options = {}) {
  if (!payload || typeof payload !== 'object') throw badRequest('Geçerli bir hesap kesimi gönderilmelidir');
  let deposited;
  let providerId = null;
  try {
    // Signed: the money limit applies to both directions (a refund-only batch
    // must not escape it, or an unbounded difference could be booked).
    deposited = parseDecimal(payload.depositedAmount, SCALE.MONEY, {
      field: 'Yatan tutar', allowZero: true, allowNegative: true, min: -LIMITS.MAX_MONEY_MINOR, max: LIMITS.MAX_MONEY_MINOR,
    });
    if (payload.providerId) providerId = objectId(String(payload.providerId), 'POS sağlayıcısı');
  } catch (error) {
    throw wrap(error);
  }
  const settlementDate = payload.settlementDate ? new Date(payload.settlementDate) : new Date();
  if (Number.isNaN(settlementDate.getTime())) throw badRequest('Geçersiz hesap kesim tarihi');
  if (settlementDate.getTime() > Date.now() + DAY_MS) throw badRequest('Hesap kesim tarihi gelecekte olamaz', 'FUTURE_SETTLEMENT');
  let branch = ctx.branch;
  if (payload.branch && payload.branch !== ctx.branch) {
    if (!ctx.isAdmin) throw forbidden('Yalnızca kendi şubenizin POS hesap kesimini kaydedebilirsiniz', 'BRANCH_MISMATCH');
    branch = await assertBranch(ctx.businessId, payload.branch);
  }
  const resolution = payload.differenceResolution || null;
  if (resolution !== null && !['commission', 'settlement_difference'].includes(resolution)) {
    throw badRequest('Fark çözümü commission veya settlement_difference olmalıdır', 'INVALID_RESOLUTION');
  }
  if (providerId && !(await PosProvider.exists({ _id: providerId, businessId: ctx.businessId }))) {
    throw notFound('POS sağlayıcısı bulunamadı', 'POS_PROVIDER_NOT_FOUND');
  }
  const manual = Array.isArray(payload.allocations) && payload.allocations.length ? payload.allocations.map((a) => {
    const id = objectId(String(a?.posTransactionId), 'POS işlemi');
    const amount = a?.amount === undefined || a?.amount === null || a?.amount === ''
      ? null
      : parseDecimal(a.amount, SCALE.MONEY, { field: 'Eşleşen tutar', allowZero: false, allowNegative: true, min: -LIMITS.MAX_MONEY_MINOR, max: LIMITS.MAX_MONEY_MINOR });
    return { id, amount };
  }) : null;
  if (manual && new Set(manual.map((a) => String(a.id))).size !== manual.length) throw badRequest('Bir POS işlemi bir kez eşleştirilebilir', 'DUPLICATE_ALLOCATION');
  const differenceAccount = resolution === 'commission' ? ACCOUNTS.posCommission : ACCOUNTS.posSettlementDifference;
  await ledger.prepareAccounts(ctx.businessId, [
    { account: ACCOUNTS.card(branch), unit: 'TRY' },
    { account: ACCOUNTS.transfer(branch), unit: 'TRY' },
    { account: differenceAccount, unit: 'TRY' },
  ]);

  return runInTransaction(async (session) => {
    const scope = { businessId: ctx.businessId, branch, providerId, status: { $ne: 'settled' } };
    let items;
    if (manual) {
      const docs = await PosTransaction.find({ ...scope, _id: { $in: manual.map((a) => a.id) } }).session(session).lean();
      if (docs.length !== manual.length) {
        throw unprocessable('Eşleştirilen işlemlerin bir kısmı bulunamadı, başka sağlayıcıya/şubeye ait ya da zaten kapanmış', 'POS_TRANSACTION_NOT_OPEN');
      }
      items = manual.map((a) => {
        const doc = docs.find((d) => String(d._id) === String(a.id));
        const open = openAmount(doc);
        const amount = a.amount === null ? open : a.amount;
        if (amount === 0n || (open > 0n && (amount < 0n || amount > open)) || (open < 0n && amount !== open)) {
          throw unprocessable(`İşlem ${doc._id}: eşleşen tutar açık tutarı (${money(open)} TL) aşamaz; iadeler tam eşleştirilir`, 'ALLOCATION_EXCEEDS_OPEN', {
            posTransactionId: String(doc._id), open: money(open),
          });
        }
        return { doc, amount };
      });
    } else {
      const endOfDay = new Date(settlementDate.getTime());
      endOfDay.setHours(23, 59, 59, 999);
      const docs = await PosTransaction.find({ ...scope, $or: [{ expectedSettlementDate: { $lte: endOfDay } }, { expectedSettlementDate: null }] })
        .sort({ expectedSettlementDate: 1, capturedAt: 1, _id: 1 }).session(session).lean();
      items = docs.map((doc) => ({ doc, amount: openAmount(doc) })).filter((i) => i.amount !== 0n);
    }
    if (!items.length) throw unprocessable('Eşleştirilecek açık POS alacağı yok', 'NOTHING_TO_SETTLE');
    const expected = items.reduce((s, i) => s + i.amount, 0n);
    assertSettlementDirection(expected, deposited);
    const difference = deposited - expected;
    if (difference !== 0n && !resolution) {
      throw unprocessable(
        `Yatan tutar (${money(deposited)} TL) beklenen net tutardan (${money(expected)} TL) farklı; fark (${money(difference)} TL) için çözüm seçin`,
        'SETTLEMENT_DIFFERENCE_UNRESOLVED',
        { expected: money(expected), deposited: money(deposited), difference: money(difference) },
      );
    }
    for (const { doc, amount } of items) {
      const settled = BigInt(doc.settledMinor || 0) + amount;
      const res = await PosTransaction.updateOne(
        { _id: doc._id, businessId: ctx.businessId, settledMinor: doc.settledMinor || 0 },
        { $set: { settledMinor: toSafeInteger(settled), status: statusFor(BigInt(doc.netMinor), settled) } },
        { session },
      );
      if (res.matchedCount !== 1) throw conflict('POS işlemi bu sırada başka bir hesap kesimiyle eşleşti', 'POS_TRANSACTION_CHANGED');
    }
    // Signed form of  Dr transfer (deposited) / Cr card (expected) / ∓ difference:
    // a refund-only batch credits the bank account and debits the card
    // account (whose refunds left it in credit). Σ = deposited − expected − difference = 0.
    const lines = [
      signedLine(ACCOUNTS.transfer(branch), deposited),
      signedLine(ACCOUNTS.card(branch), -expected),
      signedLine(differenceAccount, -difference),
    ];
    const settlement = new PosSettlement({
      businessId: ctx.businessId,
      branch,
      providerId,
      settlementDate,
      bankReference: typeof payload.bankReference === 'string' ? payload.bankReference.trim().slice(0, 80) : undefined,
      allocations: items.map((i) => ({ posTransactionId: i.doc._id, amountMinor: toSafeInteger(i.amount) })),
      expectedMinor: toSafeInteger(expected),
      depositedMinor: toSafeInteger(deposited),
      differenceMinor: toSafeInteger(difference),
      differenceResolution: difference === 0n ? null : resolution,
      notes: typeof payload.notes === 'string' ? payload.notes.trim().slice(0, 500) : undefined,
      createdBy: ctx.userId || null,
    });
    // A netted batch (captures = refunds, nothing deposited, no difference)
    // moves no money: the items are closed by the settlement document alone.
    const netted = expected === 0n && deposited === 0n && difference === 0n;
    const entry = netted ? null : await ledger.postEntry(session, { ...ctx, branch }, {
      entryType: 'pos_settlement',
      reference: { kind: 'PosSettlement', id: String(settlement._id) },
      branch,
      description: `POS hesap kesimi${settlement.bankReference ? ` (${settlement.bankReference})` : ''}: ${items.length} işlem`,
      lines,
    });
    settlement.journalEntryId = entry ? entry._id : null;
    await settlement.save({ session });
    if (options.idempotency) await options.idempotency.remember(session, { resourceType: 'PosSettlement', resourceId: settlement._id, statusCode: 201 });
    if (ctx.userId) {
      await recordAudit({
        AuditLog, session, actorUserId: ctx.userId, action: 'pos.settlement_posted', resourceType: 'PosSettlement', resourceId: String(settlement._id),
        correlationId: ctx.correlationId,
        after: { expectedMinor: settlement.expectedMinor, depositedMinor: settlement.depositedMinor, differenceMinor: settlement.differenceMinor, items: items.length },
      });
    }
    return settlement;
  }).catch((error) => { throw wrap(error); });
}

/** Reverses a wrongly matched settlement: the entry is mirrored and the items reopen. */
async function reverseSettlement(ctx, id, payload = {}) {
  const _id = objectId(id, 'hesap kesimi');
  const reason = typeof payload.reason === 'string' ? payload.reason.trim().slice(0, 300) : '';
  if (!reason) throw badRequest('Ters kayıt gerekçesi girilmelidir', 'REASON_REQUIRED');
  return runInTransaction(async (session) => {
    const settlement = await PosSettlement.findOne({ _id, businessId: ctx.businessId }).session(session);
    if (!settlement || (!ctx.isAdmin && settlement.branch !== ctx.branch)) throw notFound('Hesap kesimi bulunamadı', 'POS_SETTLEMENT_NOT_FOUND');
    if (settlement.status === 'reversed') throw conflict('Bu hesap kesimi zaten ters kayda alınmış', 'ALREADY_REVERSED');
    for (const a of settlement.allocations) {
      const doc = await PosTransaction.findOne({ _id: a.posTransactionId, businessId: ctx.businessId }).session(session).lean();
      const settled = BigInt(doc.settledMinor || 0) - BigInt(a.amountMinor);
      const res = await PosTransaction.updateOne(
        { _id: doc._id, businessId: ctx.businessId, settledMinor: doc.settledMinor },
        { $set: { settledMinor: toSafeInteger(settled), status: statusFor(BigInt(doc.netMinor), settled) } },
        { session },
      );
      if (res.matchedCount !== 1) throw conflict('POS işlemi bu sırada değişti; lütfen tekrar deneyin', 'POS_TRANSACTION_CHANGED');
    }
    // A netted settlement has no journal entry: reopening its items is the whole reversal.
    const reversal = settlement.journalEntryId
      ? await ledger.reverseEntry(session, { ...ctx, branch: settlement.branch }, settlement.journalEntryId, {
        entryType: 'pos_settlement_reversal', description: `POS hesap kesimi ters kaydı: ${reason}`,
      })
      : null;
    settlement.status = 'reversed';
    settlement.reversedAt = new Date();
    settlement.reversalReason = reason;
    settlement.reversalJournalEntryId = reversal ? reversal._id : null;
    await settlement.save({ session });
    if (ctx.userId) {
      await recordAudit({
        AuditLog, session, actorUserId: ctx.userId, action: 'pos.settlement_reversed', resourceType: 'PosSettlement', resourceId: String(settlement._id),
        correlationId: ctx.correlationId, after: { reason },
      });
    }
    return settlement;
  });
}

/* --------------------------------------------------------------- views */

function transactionDto(t) {
  return {
    _id: t._id,
    branch: t.branch,
    providerId: t.providerId,
    providerCode: t.providerCode,
    kind: t.kind,
    source: t.source,
    reference: t.reference,
    installments: t.installments,
    commissionConfigured: Boolean(t.commissionSnapshot?.configured),
    ratePercent: t.commissionSnapshot?.configured ? formatRatePpm(t.commissionSnapshot.ratePpm) : null,
    fixedFee: t.commissionSnapshot?.configured ? money(t.commissionSnapshot.fixedFeeMinor || 0) : null,
    ruleVersion: t.commissionSnapshot?.ruleVersion ?? null,
    gross: money(t.grossMinor),
    commission: money(t.commissionMinor),
    net: money(t.netMinor),
    settled: money(t.settledMinor || 0),
    open: money(openAmount(t)),
    status: t.status,
    capturedAt: t.capturedAt,
    expectedSettlementDate: t.expectedSettlementDate,
    overdue: t.status !== 'settled' && t.expectedSettlementDate && new Date(t.expectedSettlementDate).getTime() < Date.now() - DAY_MS,
    terminalId: t.terminalId,
    authCode: t.authCode,
  };
}

function settlementDto(s) {
  return {
    _id: s._id,
    branch: s.branch,
    providerId: s.providerId,
    settlementDate: s.settlementDate,
    bankReference: s.bankReference,
    expected: money(s.expectedMinor),
    deposited: money(s.depositedMinor),
    difference: money(s.differenceMinor || 0),
    differenceResolution: s.differenceResolution,
    status: s.status,
    items: s.allocations.length,
    allocations: s.allocations.map((a) => ({ posTransactionId: a.posTransactionId, amount: money(a.amountMinor) })),
    reversedAt: s.reversedAt,
    reversalReason: s.reversalReason,
    notes: s.notes,
    createdAt: s.createdAt,
  };
}

/** Open receivable per provider and branch. */
async function summary(ctx, branchFilter = {}) {
  const rows = await PosTransaction.aggregate([
    { $match: { businessId: ctx.businessId, ...branchFilter } },
    { $group: {
      _id: { providerId: '$providerId', providerCode: '$providerCode', branch: '$branch' },
      gross: { $sum: '$grossMinor' },
      commission: { $sum: '$commissionMinor' },
      net: { $sum: '$netMinor' },
      settled: { $sum: '$settledMinor' },
      openItems: { $sum: { $cond: [{ $ne: ['$status', 'settled'] }, 1, 0] } },
      overdueItems: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'settled'] }, { $lt: ['$expectedSettlementDate', new Date(Date.now() - DAY_MS)] }] }, 1, 0] } },
    } },
    { $sort: { '_id.branch': 1, '_id.providerCode': 1 } },
  ]);
  return rows.map((r) => ({
    providerId: r._id.providerId,
    providerCode: r._id.providerCode,
    branch: r._id.branch,
    gross: money(r.gross),
    commission: money(r.commission),
    net: money(r.net),
    settled: money(r.settled),
    open: money(BigInt(r.net) - BigInt(r.settled)),
    openItems: r.openItems,
    overdueItems: r.overdueItems,
  }));
}

/**
 * POS sub-ledger checks:
 *  - every transaction: |settled| ≤ |net|, sign consistent, status consistent
 *  - Σ allocations of posted settlements == Σ settledMinor
 * Warning (not an error): card account balance vs open POS items per
 * branch. They differ by card postings outside the POS flow (legacy data,
 * company card payments recorded with method "kredi kartı").
 */
async function reconcile(businessId) {
  const discrepancies = [];
  const warnings = [];
  const txns = await PosTransaction.find({ businessId }).lean();
  const settledById = new Map();
  for (const t of txns) {
    const net = BigInt(t.netMinor);
    const settled = BigInt(t.settledMinor || 0);
    const bad = net >= 0n ? (settled < 0n || settled > net) : (settled > 0n || settled < net);
    if (bad) discrepancies.push({ check: 'pos_overs_settled', posTransactionId: String(t._id), net: Number(net), settled: Number(settled) });
    if (t.status !== statusFor(net, settled)) discrepancies.push({ check: 'pos_status', posTransactionId: String(t._id), status: t.status });
    if (BigInt(t.grossMinor) - BigInt(t.commissionMinor) !== net) discrepancies.push({ check: 'pos_net', posTransactionId: String(t._id) });
    settledById.set(String(t._id), settled);
  }
  const allocated = new Map();
  const settlements = await PosSettlement.find({ businessId, status: 'posted' }).lean();
  for (const s of settlements) {
    for (const a of s.allocations) allocated.set(String(a.posTransactionId), (allocated.get(String(a.posTransactionId)) || 0n) + BigInt(a.amountMinor));
  }
  for (const [id, settled] of settledById) {
    if ((allocated.get(id) || 0n) !== settled) discrepancies.push({ check: 'pos_allocations', posTransactionId: id, settled: Number(settled), allocated: Number(allocated.get(id) || 0n) });
  }
  const openByBranch = new Map();
  for (const t of txns) openByBranch.set(t.branch, (openByBranch.get(t.branch) || 0n) + BigInt(t.netMinor) - BigInt(t.settledMinor || 0));
  for (const [branch, open] of openByBranch) {
    const gl = await ledger.balanceOf(businessId, ACCOUNTS.card(branch), 'TRY');
    if (gl !== open) warnings.push({ check: 'pos_gl_difference', branch, cardAccount: Number(gl), openPosItems: Number(open), difference: Number(gl - open) });
  }
  return { ok: discrepancies.length === 0, checkedAt: new Date().toISOString(), transactionsChecked: txns.length, discrepancies, warnings };
}

/** Server-side commission preview for the UI (never trusted back as input). */
async function quote(ctx, payload) {
  let gross;
  let input;
  try {
    gross = parseDecimal(payload?.amount, SCALE.MONEY, { field: 'Tutar', allowZero: false, max: LIMITS.MAX_MONEY_MINOR });
    input = parsePosInput({ providerId: payload?.providerId, installments: payload?.installments });
  } catch (error) {
    throw wrap(error);
  }
  const plan = await planCard(ctx, ctx.branch, input);
  if (!plan.snapshot.configured) return { configured: false, gross: money(gross), commission: null, net: null };
  let result;
  try {
    result = computeCommission(gross, plan.rule);
  } catch (error) {
    throw wrap(error);
  }
  return {
    configured: true,
    providerId: plan.provider._id,
    providerCode: plan.provider.code,
    installments: input.installments,
    ratePercent: formatRatePpm(plan.rule.ratePpm),
    fixedFee: money(plan.rule.fixedFeeMinor),
    valorDays: plan.rule.valorDays,
    gross: money(gross),
    commission: money(result.commissionMinor),
    net: money(result.netMinor),
  };
}

module.exports = {
  CARD,
  createProvider,
  updateProvider,
  providerDto,
  activeProviders,
  parsePosInput,
  planPayments,
  recordCaptures,
  refundAccounts,
  recordRefund,
  paymentsOf,
  createSettlement,
  reverseSettlement,
  transactionDto,
  settlementDto,
  summary,
  reconcile,
  quote,
  paymentAccount,
};
