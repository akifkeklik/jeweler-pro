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
  parseDecimal, toSafeInteger, toDisplayNumber, format, roundDiv,
} = require('../domain/decimal');
const { SCALE, ROUNDING_MODE } = require('../domain/precision');
const ledger = require('./finance/ledgerService');
const inventory = require('./finance/inventoryService');
const pos = require('./posService');
const { resolveMetalPrices } = require('./finance/metalPricing');
const { assertBranch } = require('./finance/branchDirectory');
const { resolveVatClass, lineVat } = require('../domain/vat');
const { loadProfile } = require('./businessProfileService');
const {
  DomainError, badRequest, notFound, conflict, unprocessable, systemContext, runInTransaction, parseNumericId,
} = require('./finance/core');

const { ACCOUNTS, paymentAccount, debit, credit } = ledger;
const {
  SALE_PAYMENT_METHODS, money, asDomainError, parseAmount, parseSaleCommand, priceSaleLine, totalsOf,
} = require('./sales/saleCommand');
const {
  lineDto, quoteDto, financialView, paymentStatusOf, primaryMethod, visibleTo,
} = require('./sales/saleViews');
const { createSaleReturn } = require('./sales/saleReturn');

function httpError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
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

  const returnSale = createSaleReturn({ Sale, tx, contextFor, loadSaleForUpdate, assertJournaled, audit });

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
