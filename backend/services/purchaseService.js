/**
 * Purchase lifecycle: Purchase → stock increase → supplier payable → payment.
 * One transaction per command (stock, journal, supplier balance, purchase
 * document, idempotency record and audit commit together).
 * Business rules: backend/BUSINESS_RULES.md → "Purchases".
 */
const Purchase = require('../models/Purchase');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const MetalStock = require('../models/MetalStock');
const AuditLog = require('../models/AuditLog');
const { recordAudit } = require('../utils/audit');
const { parseDecimal, toSafeInteger, toDisplayNumber } = require('../domain/decimal');
const { SCALE, LIMITS } = require('../domain/precision');
const ledger = require('./finance/ledgerService');
const inventory = require('./finance/inventoryService');
const {
  badRequest, notFound, conflict, unprocessable, runInTransaction, parseNumericId,
} = require('./finance/core');
const { assertBranch } = require('./finance/branchDirectory');
const {
  lineReturnOf, remainingLineValue, share, parseReturnCommand,
} = require('./purchases/purchaseReturnLines');
const { purchaseDto } = require('./purchases/purchaseViews');
const {
  PAYMENT_METHODS, money, wrap, parsePayments, parsePurchaseCommand, paymentStatus, openFigures,
} = require('./purchases/purchaseCommand');

/** Non-admins only see / change purchases of their own branch; others behave as missing (404). */
function assertPurchaseVisible(ctx, purchase) {
  if (!purchase || (!ctx.isAdmin && purchase.branch !== ctx.branch)) throw notFound('Alış bulunamadı', 'PURCHASE_NOT_FOUND');
  return purchase;
}

const { ACCOUNTS, paymentAccount, debit, credit } = ledger;
function refreshPaymentStatus(purchase) {
  const { net, paid } = openFigures(purchase);
  purchase.paymentStatus = paymentStatus(net, paid);
}

async function audit(session, ctx, action, purchase, extra) {
  if (!ctx.userId) return;
  await recordAudit({
    AuditLog, session, actorUserId: ctx.userId, action, resourceType: 'Purchase', resourceId: purchase._id, correlationId: ctx.correlationId, ...extra,
  });
}

async function loadSupplier(session, ctx, supplierId) {
  const supplier = await Supplier.findOne({ _id: supplierId, businessId: ctx.businessId, isArchived: { $ne: true } }).session(session);
  if (!supplier) throw notFound('Tedarikçi bulunamadı', 'SUPPLIER_NOT_FOUND');
  return supplier;
}

async function createPurchase(ctx, payload, options = {}) {
  let command;
  try {
    command = parsePurchaseCommand(payload);
  } catch (error) {
    throw wrap(error);
  }
  const total = command.lines.reduce((s, l) => s + l.totalMinor, 0n);
  const paid = command.payments.reduce((s, p) => s + p.amountMinor, 0n);
  if (paid > total) throw badRequest('Ödeme toplamı alış tutarını aşamaz', 'OVERPAYMENT');
  // Validate the supplier inside the tenant before creating any account for it.
  if (!(await Supplier.exists({ _id: command.supplierId, businessId: ctx.businessId, isArchived: { $ne: true } }))) {
    throw notFound('Tedarikçi bulunamadı', 'SUPPLIER_NOT_FOUND');
  }

  // Goods are received into the branch that owns the purchased products —
  // never implicitly into the admin's own branch (explicit `branch` for
  // an admin purchasing on behalf of another branch).
  const productIds = [...new Set(command.lines.filter((l) => l.itemType === 'product').map((l) => l.productId))];
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds }, businessId: ctx.businessId, isArchived: { $ne: true } }).select('_id branch').lean()
    : [];
  const branch = await inventory.resolveDocumentBranch(ctx, products, payload?.branch, { assertBranch });
  const pctx = Object.freeze({ ...ctx, branch });
  await ledger.prepareAccounts(ctx.businessId, [
    { account: ACCOUNTS.inventory(branch), unit: 'TRY' },
    { account: ACCOUNTS.payable(command.supplierId), unit: 'TRY' },
    ...command.payments.map((p) => ({ account: paymentAccount(branch, p.method), unit: 'TRY' })),
  ]);
  for (const line of command.lines.filter((l) => l.itemType === 'metal')) {
    await inventory.prepareMetalPool(pctx, { branch, metal: line.metal, purity: line.purity });
  }

  try {
    return await runInTransaction(async (session) => {
      const supplier = await loadSupplier(session, ctx, command.supplierId);
      const purchase = new Purchase({
        businessId: ctx.businessId,
        branch,
        supplierId: supplier._id,
        invoiceNo: command.invoiceNo,
        notes: command.notes,
        lines: [],
        totalMinor: toSafeInteger(total),
        createdBy: ctx.userId || null,
      });
      await purchase.validate();
      const reference = { kind: 'Purchase', id: String(purchase._id) };

      const storedLines = [];
      for (const line of command.lines) {
        if (line.itemType === 'product') {
          const product = await inventory.loadProduct(session, ctx, line.productId);
          await inventory.moveProduct(session, pctx, {
            product, quantity: line.quantity, movementType: 'purchase', costMinor: line.totalMinor, reference, branch,
          });
          storedLines.push({
            lineId: line.lineId, itemType: 'product', productId: product._id, productName: product.name, quantity: line.quantity,
            unitCostMinor: toSafeInteger(line.unitCostMinor), totalMinor: toSafeInteger(line.totalMinor),
          });
        } else {
          await inventory.moveMetal(session, pctx, {
            branch, metal: line.metal, purity: line.purity, weightMg: line.weightMg, fineMg: line.fineMg,
            costMinor: line.totalMinor, movementType: 'purchase', reference,
          });
          storedLines.push({
            lineId: line.lineId, itemType: 'metal', metal: line.metal, purity: Number(line.purity),
            weightMg: toSafeInteger(line.weightMg), fineMg: toSafeInteger(line.fineMg), totalMinor: toSafeInteger(line.totalMinor),
          });
        }
      }

      const entry = total > 0n
        ? await ledger.postEntry(session, pctx, {
          entryType: 'purchase',
          reference,
          branch,
          description: `Alış #${purchase._id}${command.invoiceNo ? ` (fatura ${command.invoiceNo})` : ''}`,
          lines: [
            debit(ACCOUNTS.inventory(branch), 'TRY', total),
            credit(ACCOUNTS.payable(supplier._id), 'TRY', total, { supplierId: supplier._id }),
          ],
        })
        : null;

      const payments = [];
      if (paid > 0n) {
        const paymentEntry = await ledger.postEntry(session, pctx, {
          entryType: 'supplier_payment',
          reference,
          branch,
          description: `Alış #${purchase._id} ödemesi`,
          lines: [
            debit(ACCOUNTS.payable(supplier._id), 'TRY', paid, { supplierId: supplier._id }),
            ...command.payments.map((p) => credit(paymentAccount(branch, p.method), 'TRY', p.amountMinor)),
          ],
        });
        for (const p of command.payments) {
          payments.push({ method: p.method, amountMinor: toSafeInteger(p.amountMinor), journalEntryId: paymentEntry._id, createdBy: ctx.userId || null });
        }
      }

      purchase.set({
        lines: storedLines,
        paidMinor: toSafeInteger(paid),
        payments,
        paymentStatus: paymentStatus(total, paid),
        journalEntryId: entry ? entry._id : undefined,
      });
      await purchase.save({ session });
      if (options.idempotency) await options.idempotency.remember(session, { resourceType: 'Purchase', resourceId: purchase._id, statusCode: 201 });
      await audit(session, ctx, 'purchase.created', purchase, {
        after: { supplierId: supplier._id, totalMinor: purchase.totalMinor, paidMinor: purchase.paidMinor, lines: storedLines.length },
      });
      return purchase;
    });
  } catch (error) {
    throw wrap(error);
  }
}

async function payPurchase(ctx, id, payload, options = {}) {
  const method = payload?.method;
  if (!PAYMENT_METHODS.includes(method)) throw badRequest('Geçersiz ödeme yöntemi');
  let amount;
  try {
    amount = parseDecimal(payload?.amount, SCALE.MONEY, { field: 'Ödeme tutarı', allowZero: false, max: LIMITS.MAX_MONEY_MINOR });
  } catch (error) {
    throw wrap(error);
  }
  const purchaseId = parseNumericId(id, 'alış');
  const preview = assertPurchaseVisible(ctx, await Purchase.findOne({ _id: purchaseId, businessId: ctx.businessId }).select('supplierId branch').lean());
  // Paid from the purchase's branch accounts (same as its returns and refunds).
  const branch = preview.branch;
  const pctx = Object.freeze({ ...ctx, branch });
  await ledger.prepareAccounts(ctx.businessId, [
    { account: ACCOUNTS.payable(preview.supplierId), unit: 'TRY' },
    { account: paymentAccount(branch, method), unit: 'TRY' },
  ]);
  return runInTransaction(async (session) => {
    const purchase = assertPurchaseVisible(ctx, await Purchase.findOne({ _id: purchaseId, businessId: ctx.businessId }).session(session));
    if (purchase.status === 'cancelled') throw conflict('İptal edilmiş alışa ödeme yapılamaz', 'PURCHASE_CANCELLED');
    const remaining = openFigures(purchase).due;
    if (amount > remaining) throw badRequest(`Ödeme kalan borcu (${money(remaining)} TL) aşamaz`, 'OVERPAYMENT');
    const entry = await ledger.postEntry(session, pctx, {
      entryType: 'supplier_payment',
      reference: { kind: 'Purchase', id: String(purchase._id) },
      branch,
      description: `Alış #${purchase._id} ödemesi`,
      lines: [
        debit(ACCOUNTS.payable(purchase.supplierId), 'TRY', amount, { supplierId: purchase.supplierId }),
        credit(paymentAccount(branch, method), 'TRY', amount),
      ],
    });
    applyPurchasePayment(purchase, { method, amountMinor: amount, journalEntryId: entry._id, createdBy: ctx.userId });
    await purchase.save({ session });
    if (options.idempotency) await options.idempotency.remember(session, { resourceType: 'Purchase', resourceId: purchase._id, statusCode: 200 });
    await audit(session, ctx, 'purchase.payment_recorded', purchase, { after: { method, amountMinor: toSafeInteger(amount) } });
    return purchase;
  });
}

function applyPurchasePayment(purchase, { method, amountMinor, journalEntryId, createdBy }) {
  const paid = BigInt(purchase.paidMinor || 0) + BigInt(amountMinor);
  purchase.payments.push({ kind: 'payment', method, amountMinor: toSafeInteger(BigInt(amountMinor)), journalEntryId, createdBy: createdBy || null });
  purchase.paidMinor = toSafeInteger(paid);
  refreshPaymentStatus(purchase);
}

/**
 * Cancels a purchase: the purchased stock leaves inventory at its purchase
 * cost and the payable entry is reversed. Requires the goods to still be in
 * stock. Payments already made are NOT reversed — they remain as a debit
 * (receivable) balance on the supplier account until the supplier refunds.
 */
async function cancelPurchase(ctx, id) {
  const purchaseId = parseNumericId(id, 'alış');
  await ledger.prepareAccounts(ctx.businessId, [{ account: ACCOUNTS.inventoryAdjustment, unit: 'TRY' }]);
  assertPurchaseVisible(ctx, await Purchase.findOne({ _id: purchaseId, businessId: ctx.businessId }).select('branch').lean());
  return runInTransaction(async (session) => {
    const purchase = assertPurchaseVisible(ctx, await Purchase.findOne({ _id: purchaseId, businessId: ctx.businessId }).session(session));
    if (purchase.status === 'cancelled') throw conflict('Bu alış zaten iptal edilmiş', 'PURCHASE_CANCELLED');
    if (purchase.returns?.length) {
      throw conflict('İade veya fiyat farkı işlenmiş alış iptal edilemez; kalan kalemler için iade alışı kullanın', 'PURCHASE_HAS_RETURNS');
    }
    const reference = { kind: 'Purchase', id: String(purchase._id) };
    const purchaseCtx = { ...ctx, branch: purchase.branch };
    let removedCost = 0n;
    for (const line of purchase.lines) {
      if (line.itemType === 'product') {
        const product = await Product.findOne({ _id: line.productId, businessId: ctx.businessId }).session(session);
        if (!product) throw conflict('Ürün kaydı bulunamadı', 'PRODUCT_NOT_FOUND');
        if ((product.stock || 0) < line.quantity) {
          throw conflict(`${product.name}: alınan ürünlerin bir kısmı satılmış; alış iptal edilemez (iade alışı kullanın)`, 'PURCHASED_STOCK_CONSUMED');
        }
        const moved = await inventory.moveProduct(session, purchaseCtx, {
          product, quantity: -line.quantity, movementType: 'purchase_cancel', reference, branch: purchase.branch,
        });
        removedCost += moved.costMinor || 0n;
      } else {
        const moved = await inventory.moveMetal(session, purchaseCtx, {
          branch: purchase.branch, metal: line.metal, purity: line.purity,
          weightMg: -line.weightMg, fineMg: -line.fineMg, movementType: 'purchase_cancel', reference,
        });
        removedCost += moved.costMinor;
      }
    }
    let cancelEntry = null;
    if (purchase.journalEntryId) {
      cancelEntry = await ledger.reverseEntry(session, purchaseCtx, purchase.journalEntryId, {
        entryType: 'purchase_cancel', description: `Alış #${purchase._id} iptali`, reference,
      });
    }
    // Average-cost issue can differ from the purchase cost when other stock of
    // the same item was bought at another price: book the difference.
    const difference = removedCost - BigInt(purchase.totalMinor);
    if (difference !== 0n) {
      await ledger.postEntry(session, purchaseCtx, {
        entryType: 'inventory_adjustment',
        reference,
        description: `Alış #${purchase._id} iptali maliyet farkı`,
        lines: difference > 0n
          ? [debit(ACCOUNTS.inventoryAdjustment, 'TRY', difference), credit(ACCOUNTS.inventory(purchase.branch), 'TRY', difference)]
          : [debit(ACCOUNTS.inventory(purchase.branch), 'TRY', -difference), credit(ACCOUNTS.inventoryAdjustment, 'TRY', -difference)],
      });
    }
    purchase.status = 'cancelled';
    purchase.cancelledAt = new Date();
    purchase.cancelJournalEntryId = cancelEntry ? cancelEntry._id : null;
    await purchase.save({ session });
    await audit(session, ctx, 'purchase.cancelled', purchase, { after: { status: 'cancelled', removedCostMinor: toSafeInteger(removedCost) } });
    return purchase;
  });
}

/** Allocates a supplier payment posted to the payable account to open purchases (oldest first). */
async function allocateSupplierPayment(session, ctx, { supplierId, amountMinor, method, journalEntryId }) {
  let left = BigInt(amountMinor);
  const allocations = [];
  const open = await Purchase.find({ businessId: ctx.businessId, supplierId, status: 'completed', paymentStatus: { $ne: 'paid' } })
    .sort({ date: 1, _id: 1 }).session(session);
  for (const purchase of open) {
    if (left <= 0n) break;
    const remaining = openFigures(purchase).due;
    if (remaining <= 0n) continue;
    const part = remaining < left ? remaining : left;
    applyPurchasePayment(purchase, { method, amountMinor: part, journalEntryId, createdBy: ctx.userId });
    await purchase.save({ session });
    allocations.push({ purchaseId: purchase._id, amountMinor: toSafeInteger(part) });
    left -= part;
  }
  return allocations;
}

/* ------------------------------------------------------- purchase returns */

async function returnPurchase(ctx, id, payload, options = {}) {
  let command;
  try {
    command = parseReturnCommand(payload);
  } catch (error) {
    throw wrap(error);
  }
  const purchaseId = parseNumericId(id, 'alış');
  const preview = assertPurchaseVisible(ctx, await Purchase.findOne({ _id: purchaseId, businessId: ctx.businessId }).lean());
  const branch = preview.branch;
  await ledger.prepareAccounts(ctx.businessId, [
    { account: ACCOUNTS.payable(preview.supplierId), unit: 'TRY' },
    { account: ACCOUNTS.inventory(branch), unit: 'TRY' },
    { account: ACCOUNTS.purchaseReturnVariance, unit: 'TRY' },
    { account: ACCOUNTS.purchasePriceAdjustment, unit: 'TRY' },
    ...command.refunds.map((r) => ({ account: paymentAccount(branch, r.method), unit: 'TRY' })),
  ]);

  try {
    return await runInTransaction(async (session) => {
      const purchase = assertPurchaseVisible(ctx, await Purchase.findOne({ _id: purchaseId, businessId: ctx.businessId }).session(session));
      if (purchase.status === 'cancelled') throw conflict('İptal edilmiş alış iade edilemez', 'PURCHASE_CANCELLED');
      const pctx = { ...ctx, branch: purchase.branch };
      const reference = { kind: 'Purchase', id: String(purchase._id) };
      const returnId = (purchase.returns?.length || 0) + 1;
      let amountTotal = 0n;
      let costTotal = 0n;
      const stored = [];

      for (const req of command.lines) {
        const line = purchase.lines.find((l) => l.lineId === req.lineId);
        if (!line) throw badRequest(`Alış satırı bulunamadı: ${req.lineId}`, 'PURCHASE_LINE_NOT_FOUND');
        const done = lineReturnOf(purchase, line.lineId);
        const remainingValue = remainingLineValue(line, done);

        if (command.kind === 'price_adjustment') {
          if (req.amountMinor > remainingValue) {
            throw conflict(`Fiyat farkı satırın kalan değerini (${money(remainingValue)} TL) aşamaz`, 'ADJUSTMENT_EXCEEDS_LINE', {
              lineId: line.lineId, remaining: money(remainingValue),
            });
          }
          done.adjustedMinor = toSafeInteger(BigInt(done.adjustedMinor || 0) + req.amountMinor);
          amountTotal += req.amountMinor;
          stored.push({ lineId: line.lineId, amountMinor: toSafeInteger(req.amountMinor), costMinor: null });
          continue;
        }

        if (line.itemType === 'product') {
          const remainingUnits = line.quantity - (done.quantity || 0);
          const quantity = req.quantity ?? remainingUnits;
          if (req.weightMg !== undefined) throw badRequest('Ürün satırı adet ile iade edilir', 'INVALID_QUANTITY');
          if (quantity <= 0 || quantity > remainingUnits) {
            throw conflict(`${line.productName}: en fazla ${remainingUnits} adet iade edilebilir`, 'RETURN_EXCEEDS_PURCHASED', {
              lineId: line.lineId, returnable: remainingUnits, requested: quantity,
            });
          }
          const product = await Product.findOne({ _id: line.productId, businessId: ctx.businessId }).session(session);
          if (!product) throw conflict('Ürün kaydı bulunamadı', 'PRODUCT_NOT_FOUND');
          const free = (product.stock || 0) - inventory.reservedOf(product);
          if (free < quantity) {
            throw conflict(
              `${product.name}: iade için yeterli fiziksel stok yok (serbest ${free}, istenen ${quantity}). `
              + 'Satılmış ürünler tedarikçiye iade edilemez; tedarikçiden fiyat farkı / alacak dekontu (price_adjustment) kaydedin.',
              'INSUFFICIENT_STOCK_FOR_RETURN',
              { lineId: line.lineId, available: Math.max(free, 0), requested: quantity, alternative: 'price_adjustment' },
            );
          }
          if (inventory.effectivePool(product) === null) {
            throw unprocessable(`${product.name}: stoğun maliyeti bilinmiyor; iade öncesi maliyet düzeltmesi yapın`, 'UNKNOWN_EXISTING_COST');
          }
          const amount = share(remainingValue, quantity, remainingUnits);
          const moved = await inventory.moveProduct(session, pctx, {
            product, quantity: -quantity, movementType: 'purchase_return', reference, branch: purchase.branch, reason: command.reason,
          });
          done.quantity = (done.quantity || 0) + quantity;
          done.amountMinor = toSafeInteger(BigInt(done.amountMinor || 0) + amount);
          amountTotal += amount;
          costTotal += moved.costMinor;
          stored.push({ lineId: line.lineId, quantity, amountMinor: toSafeInteger(amount), costMinor: toSafeInteger(moved.costMinor) });
        } else {
          const remainingWeight = BigInt(line.weightMg) - BigInt(done.weightMg || 0);
          const weight = req.weightMg ?? remainingWeight;
          if (req.quantity !== undefined) throw badRequest('Maden satırı gramaj ile iade edilir', 'INVALID_QUANTITY');
          if (weight <= 0n || weight > remainingWeight) {
            throw conflict(`En fazla ${toDisplayNumber(remainingWeight, 3)} gr iade edilebilir`, 'RETURN_EXCEEDS_PURCHASED', {
              lineId: line.lineId, returnableWeightGrams: toDisplayNumber(remainingWeight, 3),
            });
          }
          // Fine content of the returned share of THIS line (purity is the line's).
          const remainingFine = BigInt(line.fineMg) - BigInt(done.fineMg || 0);
          const fine = share(remainingFine, weight, remainingWeight);
          const amount = share(remainingValue, weight, remainingWeight);
          const pool = await MetalStock.findById(MetalStock.idFor(ctx.businessId, purchase.branch, line.metal, line.purity)).session(session).lean();
          const freeW = pool ? BigInt(pool.weightMg) - BigInt(pool.reservedWeightMg || 0) : 0n;
          const freeF = pool ? BigInt(pool.fineMg) - BigInt(pool.reservedFineMg || 0) : 0n;
          if (freeW < weight || freeF < fine) {
            throw conflict(
              `İade için yeterli ${line.metal} ${line.purity / 10}‰ maden stoğu yok (serbest ${toDisplayNumber(freeW > 0n ? freeW : 0n, 3)} gr). `
              + 'Tüketilmiş maden için tedarikçiden fiyat farkı / alacak dekontu (price_adjustment) kaydedin.',
              'INSUFFICIENT_STOCK_FOR_RETURN',
              { lineId: line.lineId, availableWeightGrams: toDisplayNumber(freeW > 0n ? freeW : 0n, 3), alternative: 'price_adjustment' },
            );
          }
          const moved = await inventory.moveMetal(session, pctx, {
            branch: purchase.branch, metal: line.metal, purity: line.purity,
            weightMg: -weight, fineMg: -fine, movementType: 'purchase_return', reference, reason: command.reason,
          });
          done.weightMg = toSafeInteger(BigInt(done.weightMg || 0) + weight);
          done.fineMg = toSafeInteger(BigInt(done.fineMg || 0) + fine);
          done.amountMinor = toSafeInteger(BigInt(done.amountMinor || 0) + amount);
          amountTotal += amount;
          costTotal += moved.costMinor;
          stored.push({
            lineId: line.lineId, weightMg: toSafeInteger(weight), fineMg: toSafeInteger(fine), amountMinor: toSafeInteger(amount), costMinor: toSafeInteger(moved.costMinor),
          });
        }
      }

      const variance = amountTotal - costTotal;
      const supplierLine = debit(ACCOUNTS.payable(purchase.supplierId), 'TRY', amountTotal, { supplierId: purchase.supplierId });
      const lines = command.kind === 'price_adjustment'
        ? [supplierLine, credit(ACCOUNTS.purchasePriceAdjustment, 'TRY', amountTotal)]
        : [
          supplierLine,
          credit(ACCOUNTS.inventory(purchase.branch), 'TRY', costTotal),
          variance > 0n ? credit(ACCOUNTS.purchaseReturnVariance, 'TRY', variance) : debit(ACCOUNTS.purchaseReturnVariance, 'TRY', -variance),
        ];
      if (amountTotal === 0n && costTotal === 0n) throw conflict('İade edilecek değer kalmadı', 'NOTHING_TO_RETURN');
      const entry = await ledger.postEntry(session, pctx, {
        entryType: command.kind === 'price_adjustment' ? 'purchase_price_adjustment' : 'purchase_return',
        reference,
        branch: purchase.branch,
        description: `Alış #${purchase._id} ${command.kind === 'price_adjustment' ? 'fiyat farkı' : 'iadesi'}${command.creditNoteNo ? ` (belge ${command.creditNoteNo})` : ''}`,
        lines,
      });

      purchase.returnedMinor = toSafeInteger(BigInt(purchase.returnedMinor || 0) + amountTotal);
      let refundTotal = 0n;
      if (command.refunds.length) {
        refundTotal = command.refunds.reduce((sum, r) => sum + r.amountMinor, 0n);
        const creditDue = -openFigures(purchase).due;
        if (refundTotal > creditDue) {
          throw badRequest(`Tedarikçi iadesi bu alıştaki alacağımızı (${money(creditDue > 0n ? creditDue : 0n)} TL) aşamaz`, 'REFUND_EXCEEDS_CREDIT');
        }
        await postSupplierRefund(session, pctx, purchase, command.refunds, reference);
      }
      purchase.returns.push({
        returnId,
        kind: command.kind,
        lines: stored,
        amountMinor: toSafeInteger(amountTotal),
        costMinor: toSafeInteger(costTotal),
        varianceMinor: command.kind === 'goods' ? toSafeInteger(variance) : 0,
        refundMinor: toSafeInteger(refundTotal),
        reason: command.reason,
        creditNoteNo: command.creditNoteNo,
        journalEntryId: entry._id,
        createdBy: ctx.userId || null,
      });
      const fullyReturned = purchase.lines.every((l) => {
        const r = purchase.lineReturns.find((x) => x.lineId === l.lineId);
        return remainingLineValue(l, r) === 0n;
      });
      purchase.returnStatus = fullyReturned ? 'full' : 'partial';
      refreshPaymentStatus(purchase);
      purchase.markModified('lineReturns');
      await purchase.save({ session });
      if (options.idempotency) await options.idempotency.remember(session, { resourceType: 'Purchase', resourceId: purchase._id, statusCode: 200 });
      await audit(session, ctx, command.kind === 'price_adjustment' ? 'purchase.price_adjusted' : 'purchase.returned', purchase, {
        after: {
          returnId, kind: command.kind, amountMinor: toSafeInteger(amountTotal), costMinor: toSafeInteger(costTotal), refundMinor: toSafeInteger(refundTotal), lines: stored,
        },
      });
      return { purchase, returnId };
    });
  } catch (error) {
    throw wrap(error);
  }
}

/** Dr cash/bank, Cr ap:{supplier} — the supplier pays back (part of) its credit. */
async function postSupplierRefund(session, ctx, purchase, refunds, reference) {
  const total = refunds.reduce((sum, r) => sum + r.amountMinor, 0n);
  const entry = await ledger.postEntry(session, ctx, {
    entryType: 'supplier_refund',
    reference,
    branch: purchase.branch,
    description: `Alış #${purchase._id} tedarikçi iadesi (geri ödeme)`,
    lines: [
      ...refunds.map((r) => debit(paymentAccount(purchase.branch, r.method), 'TRY', r.amountMinor)),
      credit(ACCOUNTS.payable(purchase.supplierId), 'TRY', total, { supplierId: purchase.supplierId }),
    ],
  });
  for (const r of refunds) {
    purchase.payments.push({ kind: 'refund', method: r.method, amountMinor: toSafeInteger(r.amountMinor), journalEntryId: entry._id, createdBy: ctx.userId || null });
  }
  purchase.refundedMinor = toSafeInteger(BigInt(purchase.refundedMinor || 0) + total);
  refreshPaymentStatus(purchase);
  return entry;
}

/** POST /api/purchases/:id/refunds — the supplier refunds money it owes after a return. */
async function recordSupplierRefund(ctx, id, payload, options = {}) {
  let refunds;
  try {
    refunds = parsePayments([payload]);
  } catch (error) {
    throw wrap(error);
  }
  const purchaseId = parseNumericId(id, 'alış');
  const preview = assertPurchaseVisible(ctx, await Purchase.findOne({ _id: purchaseId, businessId: ctx.businessId }).select('supplierId branch').lean());
  await ledger.prepareAccounts(ctx.businessId, [
    { account: ACCOUNTS.payable(preview.supplierId), unit: 'TRY' },
    { account: paymentAccount(preview.branch, refunds[0].method), unit: 'TRY' },
  ]);
  return runInTransaction(async (session) => {
    const purchase = assertPurchaseVisible(ctx, await Purchase.findOne({ _id: purchaseId, businessId: ctx.businessId }).session(session));
    const creditDue = -openFigures(purchase).due;
    if (refunds[0].amountMinor > creditDue) {
      throw badRequest(`Tedarikçi iadesi bu alıştaki alacağımızı (${money(creditDue > 0n ? creditDue : 0n)} TL) aşamaz`, 'REFUND_EXCEEDS_CREDIT');
    }
    await postSupplierRefund(session, { ...ctx, branch: purchase.branch }, purchase, refunds, { kind: 'Purchase', id: String(purchase._id) });
    await purchase.save({ session });
    if (options.idempotency) await options.idempotency.remember(session, { resourceType: 'Purchase', resourceId: purchase._id, statusCode: 200 });
    await audit(session, ctx, 'purchase.supplier_refund', purchase, { after: { method: refunds[0].method, amountMinor: toSafeInteger(refunds[0].amountMinor) } });
    return purchase;
  });
}

module.exports = {
  assertPurchaseVisible,
  createPurchase,
  payPurchase,
  cancelPurchase,
  returnPurchase,
  recordSupplierRefund,
  openFigures,
  allocateSupplierPayment,
  applyPurchasePayment,
  purchaseDto,
  parsePurchaseCommand,
};
