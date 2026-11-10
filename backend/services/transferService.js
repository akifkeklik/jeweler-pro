/**
 * Inter-branch stock transfers (şubeler arası transfer).
 *
 *   create (draft) → approve (reserve) → dispatch (out of source, into transit)
 *   → receive (partial / full, into destination) → resolve shortfall
 *     (return to source or write off)          → received
 *   draft → reject | cancel,  approved → cancel (reservation released)
 *
 * Accounting (TRY, at weighted-average cost of the source):
 *   dispatch   Dr inventory_transit       Cr inventory:{source}
 *   receive    Dr inventory:{destination} Cr inventory_transit
 *   return     Dr inventory:{source}      Cr inventory_transit
 *   write-off  Dr expense:transfer_loss   Cr inventory_transit
 * Partial amounts are cumulative proportions of the dispatched cost (the
 * last unit takes the remainder), so transit always clears to exactly zero.
 *
 * Every command is one MongoDB transaction: stock movements, reservations,
 * journal entries, the transfer document, its event history, the
 * idempotency record and the audit record commit together or not at all.
 * Business rules: backend/BUSINESS_RULES.md → "Inter-branch transfers".
 */
const Product = require('../models/Product');
const MetalStock = require('../models/MetalStock');
const StockTransfer = require('../models/StockTransfer');
const AuditLog = require('../models/AuditLog');
const LedgerEntry = require('../models/LedgerEntry');
const { recordAudit } = require('../utils/audit');
const {
  parseDecimal, roundDiv, toSafeInteger, toDisplayNumber, DecimalError,
} = require('../domain/decimal');
const { SCALE, LIMITS, ROUNDING_MODE } = require('../domain/precision');
const { resolvePurity, fineWeightMg, assertMetal } = require('../domain/metals');
const ledger = require('./finance/ledgerService');
const inventory = require('./finance/inventoryService');
const { assertBranch } = require('./finance/branchDirectory');
const {
  badRequest, notFound, conflict, forbidden, unprocessable, runInTransaction, parseNumericId,
} = require('./finance/core');

const { ACCOUNTS, debit, credit } = ledger;
const MAX_LINES = 100;
const OPEN_FOR_RECEIPT = ['in_transit', 'partially_received'];
// Catalogue attributes copied to the destination branch's copy of a product.
const COPIED_FIELDS = ['name', 'weight', 'unit', 'price', 'currency', 'description', 'categoryId', 'materialId',
  'pricingMode', 'metal', 'purity', 'laborType', 'laborValue'];

function wrap(error) {
  if (error instanceof DecimalError) return badRequest(error.message, error.code);
  return error;
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : undefined);

/* ------------------------------------------------------------------ input */

function parseTransferCommand(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw badRequest('Geçerli bir transfer bilgisi gönderilmelidir');
  if (!Array.isArray(payload.lines) || !payload.lines.length) throw badRequest('Transferde en az bir satır olmalıdır');
  if (payload.lines.length > MAX_LINES) throw badRequest(`Bir transferde en fazla ${MAX_LINES} satır olabilir`);
  const seen = new Set();
  const lines = payload.lines.map((raw, index) => {
    const lineId = index + 1;
    if (!raw || typeof raw !== 'object') throw badRequest(`${lineId}. satır geçersiz`);
    if (raw.metal) {
      const metal = assertMetal(raw.metal);
      const purity = resolvePurity(raw);
      const weightMg = parseDecimal(raw.weightGrams, SCALE.WEIGHT, { field: 'Gramaj', allowZero: false, max: LIMITS.MAX_WEIGHT_MG });
      const key = `metal:${metal}:${purity}`;
      if (seen.has(key)) throw badRequest('Aynı maden/ayar havuzu bir transferde yalnızca bir kez yer alabilir', 'DUPLICATE_TRANSFER_LINE');
      seen.add(key);
      return { lineId, itemType: 'metal', metal, purity, weightMg, fineMg: fineWeightMg(weightMg, purity) };
    }
    const productId = parseNumericId(raw.productId, 'ürün');
    const quantity = Number(raw.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > LIMITS.MAX_QUANTITY) {
      throw badRequest('Transfer miktarı pozitif bir tam sayı olmalıdır', 'INVALID_QUANTITY');
    }
    const key = `product:${productId}`;
    if (seen.has(key)) throw badRequest('Aynı ürün bir transferde yalnızca bir kez yer alabilir', 'DUPLICATE_TRANSFER_LINE');
    seen.add(key);
    const destinationProductId = raw.destinationProductId === undefined || raw.destinationProductId === null || raw.destinationProductId === ''
      ? null : parseNumericId(raw.destinationProductId, 'hedef ürün');
    return { lineId, itemType: 'product', productId, quantity, destinationProductId };
  });
  return {
    sourceBranch: text(payload.sourceBranch, 120),
    destinationBranch: text(payload.destinationBranch, 120),
    lines,
    notes: text(payload.notes, 1000),
  };
}

/**
 * Receipt / resolution quantities: { lineId, quantity } for products,
 * { lineId, weightGrams } for metal. Missing amount = everything outstanding.
 */
function parseLineAmounts(rawLines, transfer, { requireAmount }) {
  if (!Array.isArray(rawLines) || !rawLines.length) throw badRequest('En az bir satır belirtilmelidir');
  const seen = new Set();
  return rawLines.map((raw) => {
    const lineId = Number(raw?.lineId);
    const line = transfer.lines.find((l) => l.lineId === lineId);
    if (!line) throw badRequest(`Transfer satırı bulunamadı: ${raw?.lineId}`, 'TRANSFER_LINE_NOT_FOUND');
    if (seen.has(lineId)) throw badRequest('Aynı satır bir istekte yalnızca bir kez yer alabilir', 'DUPLICATE_TRANSFER_LINE');
    seen.add(lineId);
    const out = outstandingOf(line);
    let amount;
    if (line.itemType === 'product') {
      if (raw.quantity === undefined || raw.quantity === null || raw.quantity === '') {
        if (requireAmount) throw badRequest('Teslim alınan miktar girilmelidir', 'INVALID_QUANTITY');
        amount = out.quantity;
      } else {
        amount = Number(raw.quantity);
        if (!Number.isSafeInteger(amount) || amount <= 0) throw badRequest('Miktar pozitif bir tam sayı olmalıdır', 'INVALID_QUANTITY');
      }
      if (amount > out.quantity) {
        throw conflict(`${line.productName}: en fazla ${out.quantity} adet bekliyor (istenen ${amount})`, 'EXCEEDS_OUTSTANDING', {
          lineId, outstanding: out.quantity, requested: amount,
        });
      }
    } else {
      if (raw.weightGrams === undefined || raw.weightGrams === null || raw.weightGrams === '') {
        if (requireAmount) throw badRequest('Teslim alınan gramaj girilmelidir', 'INVALID_QUANTITY');
        amount = out.weightMg;
      } else {
        amount = toSafeInteger(parseDecimal(raw.weightGrams, SCALE.WEIGHT, { field: 'Gramaj', allowZero: false, max: LIMITS.MAX_WEIGHT_MG }));
      }
      if (amount > out.weightMg) {
        throw conflict(`${line.metal} ${line.purity / 10}‰: en fazla ${toDisplayNumber(BigInt(out.weightMg), 3)} gr bekliyor`, 'EXCEEDS_OUTSTANDING', {
          lineId, outstandingWeightMg: out.weightMg, requestedWeightMg: amount,
        });
      }
    }
    if (amount <= 0) throw conflict('Bu satırda bekleyen miktar yok', 'NOTHING_OUTSTANDING', { lineId });
    return { line, amount };
  });
}

/* --------------------------------------------------------- line arithmetic */

const settled = (line, field) => (line.received?.[field] || 0) + (line.returned?.[field] || 0) + (line.writtenOff?.[field] || 0);

function outstandingOf(line) {
  const d = line.dispatched || {};
  return {
    quantity: (d.quantity || 0) - settled(line, 'quantity'),
    weightMg: (d.weightMg || 0) - settled(line, 'weightMg'),
    fineMg: (d.fineMg || 0) - settled(line, 'fineMg'),
  };
}

/** Cumulative share of `total` for `part` out of `whole` (whole → total exactly). */
function share(total, part, whole) {
  if (total === null || total === undefined) return null;
  if (part >= whole) return BigInt(total);
  return roundDiv(BigInt(total) * BigInt(part), BigInt(whole), ROUNDING_MODE);
}

/**
 * The next `amount` (pieces or mg) of a dispatched line: quantity, weight,
 * fine and cost, computed as the difference of cumulative shares so that
 * all portions together are exactly the dispatched figures.
 */
function portionOf(line, amount) {
  const d = line.dispatched;
  if (line.itemType === 'product') {
    const before = settled(line, 'quantity');
    const cost = d.costMinor === null ? null : share(d.costMinor, before + amount, d.quantity) - share(d.costMinor, before, d.quantity);
    return { quantity: amount, weightMg: 0, fineMg: 0, costMinor: cost };
  }
  const before = settled(line, 'weightMg');
  const fine = share(d.fineMg, before + amount, d.weightMg) - share(d.fineMg, before, d.weightMg);
  const cost = d.costMinor === null ? null : share(d.costMinor, before + amount, d.weightMg) - share(d.costMinor, before, d.weightMg);
  return { quantity: 0, weightMg: amount, fineMg: toSafeInteger(fine), costMinor: cost };
}

function addTo(bucket, portion) {
  const cost = portion.costMinor === null || bucket.costMinor === null
    ? null
    : toSafeInteger(BigInt(bucket.costMinor || 0) + portion.costMinor);
  return {
    quantity: (bucket.quantity || 0) + portion.quantity,
    weightMg: (bucket.weightMg || 0) + portion.weightMg,
    fineMg: (bucket.fineMg || 0) + portion.fineMg,
    costMinor: cost,
  };
}

const isFullySettled = (transfer) => transfer.lines.every((line) => {
  const out = outstandingOf(line);
  return out.quantity === 0 && out.weightMg === 0;
});

/* ------------------------------------------------------------- guards */

function sourceCtx(ctx, transfer) {
  return { ...ctx, branch: transfer.sourceBranch };
}

function destinationCtx(ctx, transfer) {
  return { ...ctx, branch: transfer.destinationBranch };
}

function assertActsFor(ctx, branch, message) {
  if (!ctx.isAdmin && ctx.branch !== branch) throw forbidden(message, 'BRANCH_MISMATCH');
}

function assertStatus(transfer, allowed, action) {
  if (!allowed.includes(transfer.status)) {
    throw conflict(`Transfer "${transfer.status}" durumunda; ${action} yapılamaz`, 'INVALID_TRANSFER_STATE', {
      status: transfer.status, allowed,
    });
  }
}

/** Non-admins only see transfers that leave or reach their own branch (others behave as missing). */
function visibilityFilter(ctx) {
  if (ctx.isAdmin) return {};
  return { $or: [{ sourceBranch: ctx.branch }, { destinationBranch: ctx.branch }] };
}

async function loadTransfer(session, ctx, id) {
  const transferId = parseNumericId(id, 'transfer');
  const query = StockTransfer.findOne({ _id: transferId, businessId: ctx.businessId, ...visibilityFilter(ctx) });
  if (session) query.session(session);
  const transfer = await query;
  if (!transfer) throw notFound('Transfer bulunamadı', 'TRANSFER_NOT_FOUND');
  return transfer;
}

function sameStockIdentity(a, b) {
  return (a.pricingMode || 'fixed') === (b.pricingMode || 'fixed')
    && (a.metal || null) === (b.metal || null)
    && (a.purity || null) === (b.purity || null)
    && Number(a.weight || 0) === Number(b.weight || 0);
}

/** Validates a source product line against the source branch (draft + approval). */
function assertTransferableProduct(product, sourceBranch) {
  if (!product.branch) {
    throw unprocessable(
      `${product.name}: ürün tüm şubelerde ortak tanımlı (şubesi yok). Transfer için önce ürünü kaynak şubeye atayın.`,
      'TRANSFER_SOURCE_UNASSIGNED',
    );
  }
  if (product.branch !== sourceBranch) {
    throw unprocessable(`${product.name}: ürün ${product.branch} şubesinin stoğunda, kaynak şube ${sourceBranch} değil`, 'TRANSFER_SOURCE_MISMATCH');
  }
}

async function assertDestinationProduct(session, ctx, product, destinationProductId, destinationBranch) {
  const query = Product.findOne({ _id: destinationProductId, businessId: ctx.businessId, isArchived: { $ne: true } });
  if (session) query.session(session);
  const target = await query;
  if (!target) throw notFound('Hedef ürün bulunamadı', 'PRODUCT_NOT_FOUND');
  if (target.branch !== destinationBranch) {
    throw unprocessable(`Hedef ürün ${destinationBranch} şubesine ait değil`, 'DESTINATION_PRODUCT_BRANCH_MISMATCH');
  }
  if (target._id === product._id) throw unprocessable('Hedef ürün kaynak ürünle aynı olamaz', 'DESTINATION_PRODUCT_INVALID');
  if (!sameStockIdentity(product, target)) {
    throw unprocessable(
      `${product.name} → ${target.name}: fiyatlandırma türü, maden, ayar ve gramaj aynı olmalıdır`,
      'DESTINATION_PRODUCT_INCOMPATIBLE',
    );
  }
  return target;
}

/**
 * The destination branch's product for a line: the explicit target, the
 * original catalogue item or an earlier branch copy (same identity), or a
 * new branch copy (without barcode — barcodes are unique per business).
 */
async function resolveDestinationProduct(session, ctx, transfer, line, source) {
  if (line.destinationProductId) {
    return assertDestinationProduct(session, ctx, source, line.destinationProductId, transfer.destinationBranch);
  }
  const rootId = source.transferOriginId || source._id;
  const candidates = await Product.find({
    businessId: ctx.businessId,
    branch: transfer.destinationBranch,
    isArchived: { $ne: true },
    $or: [{ _id: rootId }, { transferOriginId: rootId }],
  }).sort({ createdAt: 1, _id: 1 }).session(session);
  const match = candidates.find((p) => sameStockIdentity(source, p));
  if (match) return match;

  const copy = new Product({
    ...Object.fromEntries(COPIED_FIELDS.filter((f) => source[f] !== undefined).map((f) => [f, source[f]])),
    businessId: ctx.businessId,
    branch: transfer.destinationBranch,
    stock: 0,
    reservedStock: 0,
    costPoolMinor: null,
    costPrice: null,
    transferOriginId: rootId,
  });
  await copy.save({ session });
  return copy;
}

/* ------------------------------------------------------------- audit */

async function audit(session, ctx, action, transfer, extra) {
  if (!ctx.userId) return;
  await recordAudit({
    AuditLog, session, actorUserId: ctx.userId, action, resourceType: 'StockTransfer', resourceId: transfer._id, correlationId: ctx.correlationId, ...extra,
  });
}

function pushEvent(transfer, ctx, { action, fromStatus, toStatus, note, details, journalEntryId }) {
  transfer.events.push({
    action, fromStatus, toStatus, note, details, journalEntryId, by: ctx.userId || null, at: new Date(),
  });
}

/* ------------------------------------------------------------- commands */

async function createTransfer(ctx, payload, options = {}) {
  let command;
  try {
    command = parseTransferCommand(payload);
  } catch (error) {
    throw wrap(error);
  }
  let sourceBranch = ctx.branch;
  if (command.sourceBranch && command.sourceBranch !== ctx.branch) {
    if (!ctx.isAdmin) throw forbidden('Yalnızca kendi şubenizden transfer başlatabilirsiniz', 'BRANCH_MISMATCH');
    sourceBranch = command.sourceBranch;
  }
  sourceBranch = await assertBranch(ctx.businessId, sourceBranch, 'Kaynak şube');
  const destinationBranch = await assertBranch(ctx.businessId, command.destinationBranch, 'Hedef şube');
  if (sourceBranch === destinationBranch) throw badRequest('Kaynak ve hedef şube aynı olamaz', 'SAME_BRANCH');

  return runInTransaction(async (session) => {
    const lines = [];
    for (const line of command.lines) {
      if (line.itemType === 'product') {
        const product = await Product.findOne({ _id: line.productId, businessId: ctx.businessId, isArchived: { $ne: true } }).session(session);
        if (!product) throw notFound('Ürün bulunamadı', 'PRODUCT_NOT_FOUND');
        assertTransferableProduct(product, sourceBranch);
        const free = (product.stock || 0) - inventory.reservedOf(product);
        if (free < line.quantity) {
          throw conflict(`Yetersiz serbest stok: ${product.name} (serbest ${free}, istenen ${line.quantity})`, 'INSUFFICIENT_STOCK', {
            productId: product._id, available: free, requested: line.quantity,
          });
        }
        if (line.destinationProductId) {
          await assertDestinationProduct(session, ctx, product, line.destinationProductId, destinationBranch);
        }
        lines.push({
          lineId: line.lineId, itemType: 'product', productId: product._id, productName: product.name,
          quantity: line.quantity, destinationProductId: line.destinationProductId,
        });
      } else {
        const pool = await MetalStock.findById(MetalStock.idFor(ctx.businessId, sourceBranch, line.metal, Number(line.purity))).session(session).lean();
        const freeW = pool ? pool.weightMg - (pool.reservedWeightMg || 0) : 0;
        if (freeW < Number(line.weightMg)) {
          throw conflict(`Kaynak şubede yeterli ${line.metal} ${Number(line.purity) / 10}‰ maden stoğu yok`, 'INSUFFICIENT_METAL_STOCK', {
            availableWeightMg: freeW, requestedWeightMg: toSafeInteger(line.weightMg),
          });
        }
        lines.push({
          lineId: line.lineId, itemType: 'metal', metal: line.metal, purity: Number(line.purity),
          weightMg: toSafeInteger(line.weightMg), fineMg: toSafeInteger(line.fineMg),
        });
      }
    }
    const transfer = new StockTransfer({
      businessId: ctx.businessId,
      sourceBranch,
      destinationBranch,
      status: 'draft',
      lines,
      notes: command.notes,
      createdBy: ctx.userId || null,
    });
    pushEvent(transfer, ctx, { action: 'created', fromStatus: null, toStatus: 'draft' });
    await transfer.save({ session });
    if (options.idempotency) await options.idempotency.remember(session, { resourceType: 'StockTransfer', resourceId: transfer._id, statusCode: 201 });
    await audit(session, ctx, 'transfer.created', transfer, { after: { sourceBranch, destinationBranch, lines: lines.length } });
    return transfer;
  }).catch((error) => { throw wrap(error); });
}

/** Approval reserves every line at the source; a non-admin cannot approve their own draft. */
async function approveTransfer(ctx, id, payload = {}) {
  return runInTransaction(async (session) => {
    const transfer = await loadTransfer(session, ctx, id);
    assertStatus(transfer, ['draft'], 'onay');
    assertActsFor(ctx, transfer.sourceBranch, 'Transferi yalnızca kaynak şube yetkilisi onaylayabilir');
    if (!ctx.isAdmin && transfer.createdBy && ctx.userId && String(transfer.createdBy) === String(ctx.userId)) {
      throw forbidden('Kendi oluşturduğunuz transferi onaylayamazsınız (görevler ayrılığı)', 'SELF_APPROVAL_FORBIDDEN');
    }
    const sctx = sourceCtx(ctx, transfer);
    for (const line of transfer.lines) {
      if (line.itemType === 'product') {
        const product = await Product.findOne({ _id: line.productId, businessId: ctx.businessId, isArchived: { $ne: true } }).session(session);
        if (!product) throw conflict(`${line.productName}: ürün artık mevcut değil`, 'PRODUCT_NOT_FOUND');
        assertTransferableProduct(product, transfer.sourceBranch);
        await inventory.reserveProduct(session, sctx, { product, quantity: line.quantity });
      } else {
        await inventory.reserveMetal(session, sctx, {
          branch: transfer.sourceBranch, metal: line.metal, purity: line.purity, weightMg: line.weightMg, fineMg: line.fineMg, sign: 1,
        });
      }
    }
    transfer.status = 'approved';
    transfer.approvedBy = ctx.userId || null;
    transfer.approvedAt = new Date();
    pushEvent(transfer, ctx, { action: 'approved', fromStatus: 'draft', toStatus: 'approved', note: text(payload.note, 500) });
    await transfer.save({ session });
    await audit(session, ctx, 'transfer.approved', transfer, { after: { status: 'approved' } });
    return transfer;
  });
}

async function rejectTransfer(ctx, id, payload = {}) {
  const reason = text(payload.reason, 500);
  if (!reason) throw badRequest('Ret gerekçesi girilmelidir', 'REASON_REQUIRED');
  return runInTransaction(async (session) => {
    const transfer = await loadTransfer(session, ctx, id);
    assertStatus(transfer, ['draft'], 'ret');
    assertActsFor(ctx, transfer.sourceBranch, 'Transferi yalnızca kaynak şube yetkilisi reddedebilir');
    transfer.status = 'rejected';
    transfer.rejectedAt = new Date();
    pushEvent(transfer, ctx, { action: 'rejected', fromStatus: 'draft', toStatus: 'rejected', note: reason });
    await transfer.save({ session });
    await audit(session, ctx, 'transfer.rejected', transfer, { after: { status: 'rejected', reason } });
    return transfer;
  });
}

/** Draft or approved transfers only: once dispatched the goods are physically on the way. */
async function cancelTransfer(ctx, id, payload = {}) {
  const reason = text(payload.reason, 500);
  if (!reason) throw badRequest('İptal gerekçesi girilmelidir', 'REASON_REQUIRED');
  return runInTransaction(async (session) => {
    const transfer = await loadTransfer(session, ctx, id);
    if (OPEN_FOR_RECEIPT.includes(transfer.status)) {
      throw conflict('Sevk edilmiş transfer iptal edilemez; teslim alın veya farkı (iade / fire) kapatın', 'TRANSFER_ALREADY_DISPATCHED');
    }
    assertStatus(transfer, ['draft', 'approved'], 'iptal');
    assertActsFor(ctx, transfer.sourceBranch, 'Transferi yalnızca kaynak şube iptal edebilir');
    const fromStatus = transfer.status;
    if (fromStatus === 'approved') {
      const sctx = sourceCtx(ctx, transfer);
      for (const line of transfer.lines) {
        if (line.itemType === 'product') {
          const product = await Product.findOne({ _id: line.productId, businessId: ctx.businessId }).session(session);
          if (!product) throw conflict(`${line.productName}: ürün bulunamadı`, 'PRODUCT_NOT_FOUND');
          await inventory.releaseProduct(session, sctx, { product, quantity: line.quantity });
        } else {
          await inventory.reserveMetal(session, sctx, {
            branch: transfer.sourceBranch, metal: line.metal, purity: line.purity, weightMg: line.weightMg, fineMg: line.fineMg, sign: -1,
          });
        }
      }
    }
    transfer.status = 'cancelled';
    transfer.cancelledAt = new Date();
    pushEvent(transfer, ctx, { action: 'cancelled', fromStatus, toStatus: 'cancelled', note: reason });
    await transfer.save({ session });
    await audit(session, ctx, 'transfer.cancelled', transfer, { before: { status: fromStatus }, after: { status: 'cancelled', reason } });
    return transfer;
  });
}

/** Issues the reserved goods from the source at weighted-average cost into transit. */
async function dispatchTransfer(ctx, id, payload = {}, options = {}) {
  const preview = await loadTransfer(null, ctx, id);
  await ledger.prepareAccounts(ctx.businessId, [
    { account: ACCOUNTS.inventoryInTransit, unit: 'TRY' },
    { account: ACCOUNTS.inventory(preview.sourceBranch), unit: 'TRY' },
  ]);
  return runInTransaction(async (session) => {
    const transfer = await loadTransfer(session, ctx, id);
    assertStatus(transfer, ['approved'], 'sevk');
    assertActsFor(ctx, transfer.sourceBranch, 'Transferi yalnızca kaynak şube sevk edebilir');
    const sctx = sourceCtx(ctx, transfer);
    const reference = { kind: 'StockTransfer', id: String(transfer._id) };
    let knownCost = 0n;
    for (const line of transfer.lines) {
      if (line.itemType === 'product') {
        const product = await Product.findOne({ _id: line.productId, businessId: ctx.businessId }).session(session);
        if (!product) throw conflict(`${line.productName}: ürün bulunamadı`, 'PRODUCT_NOT_FOUND');
        const moved = await inventory.moveProduct(session, sctx, {
          product, quantity: -line.quantity, movementType: 'transfer_out', reference, branch: transfer.sourceBranch,
          consumeReservation: line.quantity, reason: `Transfer → ${transfer.destinationBranch}`,
        });
        line.dispatched = { quantity: line.quantity, weightMg: 0, fineMg: 0, costMinor: moved.costMinor === null ? null : toSafeInteger(moved.costMinor) };
        if (moved.costMinor !== null) knownCost += moved.costMinor;
      } else {
        const moved = await inventory.moveMetal(session, sctx, {
          branch: transfer.sourceBranch, metal: line.metal, purity: line.purity,
          weightMg: -line.weightMg, fineMg: -line.fineMg, movementType: 'transfer_out', reference,
          consumeReservation: { weightMg: line.weightMg, fineMg: line.fineMg }, reason: `Transfer → ${transfer.destinationBranch}`,
        });
        line.dispatched = { quantity: 0, weightMg: line.weightMg, fineMg: line.fineMg, costMinor: toSafeInteger(moved.costMinor) };
        knownCost += moved.costMinor;
      }
    }
    let entry = null;
    if (knownCost > 0n) {
      entry = await ledger.postEntry(session, sctx, {
        entryType: 'transfer_dispatch',
        reference,
        branch: transfer.sourceBranch,
        description: `Transfer #${transfer._id} sevki: ${transfer.sourceBranch} → ${transfer.destinationBranch}`,
        lines: [debit(ACCOUNTS.inventoryInTransit, 'TRY', knownCost), credit(ACCOUNTS.inventory(transfer.sourceBranch), 'TRY', knownCost)],
      });
    }
    transfer.status = 'in_transit';
    transfer.dispatchedBy = ctx.userId || null;
    transfer.dispatchedAt = new Date();
    transfer.dispatchJournalEntryId = entry ? entry._id : null;
    transfer.markModified('lines');
    pushEvent(transfer, ctx, {
      action: 'dispatched', fromStatus: 'approved', toStatus: 'in_transit', note: text(payload.note, 500),
      details: { costMinor: toSafeInteger(knownCost) }, journalEntryId: entry ? entry._id : undefined,
    });
    await transfer.save({ session });
    if (options.idempotency) await options.idempotency.remember(session, { resourceType: 'StockTransfer', resourceId: transfer._id, statusCode: 200 });
    await audit(session, ctx, 'transfer.dispatched', transfer, { after: { status: 'in_transit', costMinor: toSafeInteger(knownCost) } });
    return transfer;
  });
}

/**
 * Receipt at the destination (partial or full). Units enter the destination
 * branch at exactly their share of the dispatched cost.
 * payload: { lines: [{ lineId, quantity } | { lineId, weightGrams }], note }
 */
async function receiveTransfer(ctx, id, payload = {}, options = {}) {
  const preview = await loadTransfer(null, ctx, id);
  assertStatus(preview, OPEN_FOR_RECEIPT, 'teslim alma');
  assertActsFor(ctx, preview.destinationBranch, 'Transferi yalnızca hedef şube teslim alabilir');
  await ledger.prepareAccounts(ctx.businessId, [
    { account: ACCOUNTS.inventoryInTransit, unit: 'TRY' },
    { account: ACCOUNTS.inventory(preview.destinationBranch), unit: 'TRY' },
  ]);
  const dctxPreview = destinationCtx(ctx, preview);
  for (const line of preview.lines.filter((l) => l.itemType === 'metal')) {
    await inventory.prepareMetalPool(dctxPreview, { branch: preview.destinationBranch, metal: line.metal, purity: line.purity });
  }

  return runInTransaction(async (session) => {
    const transfer = await loadTransfer(session, ctx, id);
    assertStatus(transfer, OPEN_FOR_RECEIPT, 'teslim alma');
    assertActsFor(ctx, transfer.destinationBranch, 'Transferi yalnızca hedef şube teslim alabilir');
    let requested;
    try {
      requested = parseLineAmounts(payload.lines, transfer, { requireAmount: false });
    } catch (error) {
      throw wrap(error);
    }
    const dctx = destinationCtx(ctx, transfer);
    const reference = { kind: 'StockTransfer', id: String(transfer._id) };
    let knownCost = 0n;
    const received = [];
    for (const { line, amount } of requested) {
      const portion = portionOf(line, amount);
      if (line.itemType === 'product') {
        const source = await Product.findOne({ _id: line.productId, businessId: ctx.businessId }).session(session);
        if (!source) throw conflict(`${line.productName}: kaynak ürün kaydı bulunamadı`, 'PRODUCT_NOT_FOUND');
        const target = await resolveDestinationProduct(session, ctx, transfer, line, source);
        await inventory.moveProduct(session, dctx, {
          product: target, quantity: amount, movementType: 'transfer_in', costMinor: portion.costMinor, reference,
          branch: transfer.destinationBranch, reason: `Transfer ← ${transfer.sourceBranch}`,
        });
        line.destinationProductId = target._id;
        received.push({ lineId: line.lineId, productId: target._id, quantity: amount, costMinor: portion.costMinor === null ? null : toSafeInteger(portion.costMinor) });
      } else {
        await inventory.moveMetal(session, dctx, {
          branch: transfer.destinationBranch, metal: line.metal, purity: line.purity,
          weightMg: portion.weightMg, fineMg: portion.fineMg, costMinor: portion.costMinor, movementType: 'transfer_in', reference,
          reason: `Transfer ← ${transfer.sourceBranch}`,
        });
        received.push({ lineId: line.lineId, weightMg: portion.weightMg, fineMg: portion.fineMg, costMinor: toSafeInteger(portion.costMinor) });
      }
      if (portion.costMinor !== null) knownCost += portion.costMinor;
      line.received = addTo(line.received || {}, portion);
    }
    let entry = null;
    if (knownCost > 0n) {
      entry = await ledger.postEntry(session, dctx, {
        entryType: 'transfer_receipt',
        reference,
        branch: transfer.destinationBranch,
        description: `Transfer #${transfer._id} teslim: ${transfer.sourceBranch} → ${transfer.destinationBranch}`,
        lines: [debit(ACCOUNTS.inventory(transfer.destinationBranch), 'TRY', knownCost), credit(ACCOUNTS.inventoryInTransit, 'TRY', knownCost)],
      });
    }
    const fromStatus = transfer.status;
    transfer.status = isFullySettled(transfer) ? 'received' : 'partially_received';
    if (transfer.status === 'received') transfer.completedAt = new Date();
    transfer.markModified('lines');
    pushEvent(transfer, ctx, {
      action: 'received', fromStatus, toStatus: transfer.status, note: text(payload.note, 500),
      details: { lines: received, costMinor: toSafeInteger(knownCost) }, journalEntryId: entry ? entry._id : undefined,
    });
    await transfer.save({ session });
    if (options.idempotency) await options.idempotency.remember(session, { resourceType: 'StockTransfer', resourceId: transfer._id, statusCode: 200 });
    await audit(session, ctx, 'transfer.received', transfer, { after: { status: transfer.status, lines: received } });
    return transfer;
  }).catch((error) => { throw wrap(error); });
}

/**
 * Closes a shortfall (units dispatched but not received):
 *   return_to_source  goods come back into the source branch at their cost
 *   write_off         lost / damaged in transit: cost to expense:transfer_loss
 * payload: { resolution, reason, lines: [{ lineId, quantity? | weightGrams? }] }
 * (missing amount = everything still outstanding on that line)
 */
async function resolveTransfer(ctx, id, payload = {}, options = {}) {
  const resolution = payload.resolution;
  if (!['return_to_source', 'write_off'].includes(resolution)) {
    throw badRequest('Çözüm türü return_to_source veya write_off olmalıdır', 'INVALID_RESOLUTION');
  }
  const reason = text(payload.reason, 500);
  if (!reason) throw badRequest('Fark kapatma gerekçesi girilmelidir', 'REASON_REQUIRED');
  const preview = await loadTransfer(null, ctx, id);
  assertStatus(preview, OPEN_FOR_RECEIPT, 'fark kapatma');
  if (!ctx.isAdmin && ![preview.sourceBranch, preview.destinationBranch].includes(ctx.branch)) {
    throw forbidden('Bu transferin farkını kapatma yetkiniz yok', 'BRANCH_MISMATCH');
  }
  const account = resolution === 'write_off' ? ACCOUNTS.transferLoss : ACCOUNTS.inventory(preview.sourceBranch);
  await ledger.prepareAccounts(ctx.businessId, [{ account: ACCOUNTS.inventoryInTransit, unit: 'TRY' }, { account, unit: 'TRY' }]);

  return runInTransaction(async (session) => {
    const transfer = await loadTransfer(session, ctx, id);
    assertStatus(transfer, OPEN_FOR_RECEIPT, 'fark kapatma');
    const rawLines = Array.isArray(payload.lines) && payload.lines.length
      ? payload.lines
      : transfer.lines.filter((l) => { const o = outstandingOf(l); return o.quantity > 0 || o.weightMg > 0; }).map((l) => ({ lineId: l.lineId }));
    let requested;
    try {
      requested = parseLineAmounts(rawLines, transfer, { requireAmount: false });
    } catch (error) {
      throw wrap(error);
    }
    const sctx = sourceCtx(ctx, transfer);
    const reference = { kind: 'StockTransfer', id: String(transfer._id) };
    let knownCost = 0n;
    const resolved = [];
    for (const { line, amount } of requested) {
      const portion = portionOf(line, amount);
      if (resolution === 'return_to_source') {
        if (line.itemType === 'product') {
          const product = await Product.findOne({ _id: line.productId, businessId: ctx.businessId }).session(session);
          if (!product) throw conflict(`${line.productName}: kaynak ürün kaydı bulunamadı`, 'PRODUCT_NOT_FOUND');
          await inventory.moveProduct(session, sctx, {
            product, quantity: amount, movementType: 'transfer_return', costMinor: portion.costMinor, reference,
            branch: transfer.sourceBranch, reason,
          });
        } else {
          await inventory.moveMetal(session, sctx, {
            branch: transfer.sourceBranch, metal: line.metal, purity: line.purity,
            weightMg: portion.weightMg, fineMg: portion.fineMg, costMinor: portion.costMinor, movementType: 'transfer_return', reference, reason,
          });
        }
        line.returned = addTo(line.returned || {}, portion);
      } else {
        line.writtenOff = addTo(line.writtenOff || {}, portion);
      }
      if (portion.costMinor !== null) knownCost += portion.costMinor;
      resolved.push({
        lineId: line.lineId, quantity: portion.quantity, weightMg: portion.weightMg, fineMg: portion.fineMg,
        costMinor: portion.costMinor === null ? null : toSafeInteger(portion.costMinor),
      });
    }
    let entry = null;
    if (knownCost > 0n) {
      entry = await ledger.postEntry(session, sctx, {
        entryType: resolution === 'write_off' ? 'transfer_loss' : 'transfer_return',
        reference,
        branch: transfer.sourceBranch,
        description: resolution === 'write_off'
          ? `Transfer #${transfer._id} kayıp/fire: ${reason}`
          : `Transfer #${transfer._id} kaynağa iade: ${reason}`,
        lines: [
          debit(resolution === 'write_off' ? ACCOUNTS.transferLoss : ACCOUNTS.inventory(transfer.sourceBranch), 'TRY', knownCost),
          credit(ACCOUNTS.inventoryInTransit, 'TRY', knownCost),
        ],
      });
    }
    const fromStatus = transfer.status;
    transfer.status = isFullySettled(transfer) ? 'received' : 'partially_received';
    if (transfer.status === 'received') transfer.completedAt = new Date();
    transfer.markModified('lines');
    pushEvent(transfer, ctx, {
      action: resolution === 'write_off' ? 'written_off' : 'returned_to_source', fromStatus, toStatus: transfer.status, note: reason,
      details: { lines: resolved, costMinor: toSafeInteger(knownCost) }, journalEntryId: entry ? entry._id : undefined,
    });
    await transfer.save({ session });
    if (options.idempotency) await options.idempotency.remember(session, { resourceType: 'StockTransfer', resourceId: transfer._id, statusCode: 200 });
    await audit(session, ctx, `transfer.${resolution}`, transfer, { after: { status: transfer.status, lines: resolved, reason } });
    return transfer;
  }).catch((error) => { throw wrap(error); });
}

/* -------------------------------------------------------- reconciliation */

/**
 * Transfer sub-ledger checks:
 *  - goods-in-transit account == Σ outstanding known cost of open transfers
 *  - every line conserves quantity, weight, fine content and cost
 *  - reserved stock == Σ approved (not yet dispatched) transfer lines
 */
async function reconcile(businessId) {
  const discrepancies = [];
  const transfers = await StockTransfer.find({ businessId, status: { $in: ['approved', 'in_transit', 'partially_received', 'received'] } }).lean();
  let expectedTransit = 0n;
  const reservedByProduct = new Map();
  const reservedByPool = new Map();
  for (const t of transfers) {
    for (const line of t.lines) {
      if (t.status === 'approved') {
        if (line.itemType === 'product') reservedByProduct.set(line.productId, (reservedByProduct.get(line.productId) || 0) + line.quantity);
        else {
          const key = MetalStock.idFor(businessId, t.sourceBranch, line.metal, line.purity);
          const r = reservedByPool.get(key) || { weightMg: 0, fineMg: 0 };
          reservedByPool.set(key, { weightMg: r.weightMg + line.weightMg, fineMg: r.fineMg + line.fineMg });
        }
        continue;
      }
      const d = line.dispatched || {};
      for (const field of ['quantity', 'weightMg', 'fineMg']) {
        if (settled(line, field) > (d[field] || 0)) {
          discrepancies.push({ check: 'transfer_line_overrun', transferId: t._id, lineId: line.lineId, field, dispatched: d[field] || 0, settled: settled(line, field) });
        }
      }
      if (d.costMinor !== null && d.costMinor !== undefined) {
        const settledCost = ['received', 'returned', 'writtenOff'].reduce((s, k) => s + BigInt(line[k]?.costMinor || 0), 0n);
        const outstanding = BigInt(d.costMinor) - settledCost;
        if (outstanding < 0n) discrepancies.push({ check: 'transfer_cost_overrun', transferId: t._id, lineId: line.lineId });
        if (t.status === 'received' && outstanding !== 0n) {
          discrepancies.push({ check: 'transfer_cost_not_cleared', transferId: t._id, lineId: line.lineId, outstanding: Number(outstanding) });
        }
        expectedTransit += outstanding;
      }
    }
  }
  const transitBalance = await ledger.balanceOf(businessId, ACCOUNTS.inventoryInTransit, 'TRY');
  if (transitBalance !== expectedTransit) {
    discrepancies.push({ check: 'transit_balance', ledger: Number(transitBalance), transfers: Number(expectedTransit) });
  }

  const reservedProducts = await Product.find({ businessId, reservedStock: { $gt: 0 } }).select('_id name reservedStock').lean();
  const seen = new Set();
  for (const p of reservedProducts) {
    seen.add(p._id);
    if ((reservedByProduct.get(p._id) || 0) !== p.reservedStock) {
      discrepancies.push({ check: 'reservation', productId: p._id, name: p.name, stored: p.reservedStock, transfers: reservedByProduct.get(p._id) || 0 });
    }
  }
  for (const [productId, quantity] of reservedByProduct) {
    if (!seen.has(productId)) discrepancies.push({ check: 'reservation', productId, stored: 0, transfers: quantity });
  }
  const pools = await MetalStock.find({ businessId, $or: [{ reservedWeightMg: { $gt: 0 } }, { reservedFineMg: { $gt: 0 } }] }).lean();
  const seenPools = new Set();
  for (const pool of pools) {
    seenPools.add(pool._id);
    const expected = reservedByPool.get(pool._id) || { weightMg: 0, fineMg: 0 };
    if (expected.weightMg !== (pool.reservedWeightMg || 0) || expected.fineMg !== (pool.reservedFineMg || 0)) {
      discrepancies.push({ check: 'metal_reservation', pool: pool._id, stored: { weightMg: pool.reservedWeightMg, fineMg: pool.reservedFineMg }, transfers: expected });
    }
  }
  for (const [pool, expected] of reservedByPool) {
    if (!seenPools.has(pool)) discrepancies.push({ check: 'metal_reservation', pool, stored: null, transfers: expected });
  }

  return {
    ok: discrepancies.length === 0,
    checkedAt: new Date().toISOString(),
    transfersChecked: transfers.length,
    inTransitCostTry: toDisplayNumber(expectedTransit, 2),
    discrepancies,
  };
}

/* ------------------------------------------------------------------ view */

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

async function journalOf(ctx, transferId) {
  return LedgerEntry.find({ businessId: ctx.businessId, 'reference.kind': 'StockTransfer', 'reference.id': String(transferId) }).sort({ date: 1 }).lean();
}

module.exports = {
  createTransfer,
  approveTransfer,
  rejectTransfer,
  cancelTransfer,
  dispatchTransfer,
  receiveTransfer,
  resolveTransfer,
  reconcile,
  loadTransfer,
  visibilityFilter,
  transferDto,
  journalOf,
  parseTransferCommand,
  portionOf,
  outstandingOf,
};
