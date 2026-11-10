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
const { toSafeInteger, DecimalError } = require('../domain/decimal');
const ledger = require('./finance/ledgerService');
const inventory = require('./finance/inventoryService');
const { assertBranch } = require('./finance/branchDirectory');
const {
  badRequest, notFound, conflict, forbidden, unprocessable, runInTransaction, parseNumericId,
} = require('./finance/core');

const {
  text, parseTransferCommand, parseLineAmounts, outstandingOf, portionOf, addTo, isFullySettled,
} = require('./transfers/transferLines');
const { reconcile } = require('./transfers/transferReconciliation');
const { transferDto } = require('./transfers/transferViews');

const { ACCOUNTS, debit, credit } = ledger;
const OPEN_FOR_RECEIPT = ['in_transit', 'partially_received'];
// Catalogue attributes copied to the destination branch's copy of a product.
const COPIED_FIELDS = ['name', 'weight', 'unit', 'price', 'currency', 'description', 'categoryId', 'materialId',
  'pricingMode', 'metal', 'purity', 'laborType', 'laborValue'];

function wrap(error) {
  if (error instanceof DecimalError) return badRequest(error.message, error.code);
  return error;
}

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
