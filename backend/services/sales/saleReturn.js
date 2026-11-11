/**
 * Partial or full return of sold items: stock goes back to the sale's branch
 * at the original cost, revenue, COGS and KDV are reversed proportionally
 * (cumulatively, so returning every unit reverses each line exactly) and money
 * already paid beyond the new net value is refunded or stays as account credit.
 * One transaction per return. Business rules: backend/BUSINESS_RULES.md → "Sales".
 */
const ledger = require('../finance/ledgerService');
const inventory = require('../finance/inventoryService');
const pos = require('../posService');
const { toSafeInteger, roundDiv } = require('../../domain/decimal');
const { ROUNDING_MODE } = require('../../domain/precision');
const { returnedVat } = require('../../domain/vat');
const {
  badRequest, notFound, conflict, parseNumericId,
} = require('../finance/core');
const { REFUND_METHODS, asDomainError } = require('./saleCommand');
const { paymentStatusOf, visibleTo } = require('./saleViews');

const { ACCOUNTS, paymentAccount, debit, credit } = ledger;

/** Builds returnSale over the sales service's model, transaction and audit helpers. */
function createSaleReturn({ Sale, tx, contextFor, loadSaleForUpdate, assertJournaled, audit }) {
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

  return returnSale;
}

module.exports = { createSaleReturn };
