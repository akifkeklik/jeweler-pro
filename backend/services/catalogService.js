/**
 * Product create / update through the inventory engine.
 *  - opening stock on create      → 'opening' movement (+ inventory journal if cost known)
 *  - a changed `stock` on update  → 'adjustment' movement (requires inventory:adjust)
 *  - a changed `costPrice`        → 'revaluation' (requires inventory:adjust)
 * so every stock and cost change is traceable and reconciles with the ledger.
 */
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');
const { recordAudit } = require('../utils/audit');
const { writableData } = require('../utils/crudOperations');
const { hasPermission } = require('../middleware/authorization');
const { parseDecimal, toDisplayNumber, DecimalError } = require('../domain/decimal');
const { SCALE, LIMITS } = require('../domain/precision');
const { resolvePurity, assertMetal } = require('../domain/metals');
const { parseLabor, PRICING_MODES } = require('../domain/pricing');
const ledger = require('./finance/ledgerService');
const inventory = require('./finance/inventoryService');
const {
  badRequest, conflict, forbidden, notFound, runInTransaction,
} = require('./finance/core');
const { assertBranch } = require('./finance/branchDirectory');

/**
 * Authority over a product's branch field (client-supplied, never trusted):
 * non-admins may only use their own branch (or leave it shared); admins may
 * name any ACTIVE branch of the business.
 */
async function assertBranchAssignable(ctx, branch) {
  if (branch === undefined || branch === '' || branch === ctx.branch) return;
  if (!ctx.isAdmin) throw forbidden('Yalnızca kendi şubenize ürün atayabilirsiniz', 'BRANCH_MISMATCH');
  await assertBranch(ctx.businessId, branch);
}

const { ACCOUNTS, debit, credit } = ledger;
// Handled explicitly below, never through the generic writable filter.
const SPECIAL_FIELDS = ['stock', 'costPrice', 'pricingMode', 'metal', 'purity', 'laborType', 'laborValue', 'weight', 'price', 'branch'];

function wrap(error) {
  if (error instanceof DecimalError) return badRequest(error.message, error.code);
  return error;
}

const present = (v) => v !== undefined && v !== null && v !== '';

/** Validates pricing / measurement fields → $set fragment (only fields present in `body`). */
function parsePricing(body, existing = {}) {
  const set = {};
  if (body.price !== undefined) {
    set.price = body.price === null ? null : toDisplayNumber(parseDecimal(body.price, SCALE.MONEY, { field: 'Satış fiyatı', max: LIMITS.MAX_MONEY_MINOR }), 2);
  }
  if (body.weight !== undefined) {
    set.weight = body.weight === null || body.weight === '' ? null : toDisplayNumber(parseDecimal(body.weight, SCALE.WEIGHT, { field: 'Gramaj', max: LIMITS.MAX_WEIGHT_MG }), 3);
  }
  if (body.pricingMode !== undefined) {
    if (!PRICING_MODES.includes(body.pricingMode)) throw badRequest('Fiyatlandırma türü fixed veya gram olmalıdır');
    set.pricingMode = body.pricingMode;
  }
  if (body.metal !== undefined) set.metal = body.metal === null || body.metal === '' ? null : assertMetal(body.metal);
  if (present(body.purity) || present(body.milyem) || present(body.karat)) {
    set.purity = Number(resolvePurity(body));
  } else if (body.purity === null) {
    set.purity = null;
  }
  if (body.laborType !== undefined || body.laborValue !== undefined) {
    const labor = parseLabor(body.laborType ?? existing.laborType ?? 'none', body.laborValue ?? existing.laborValue ?? 0);
    set.laborType = labor.laborType;
    set.laborValue = toDisplayNumber(labor.laborValue, labor.laborType === 'milyem' ? SCALE.MILYEM : SCALE.MONEY);
  }
  if (body.branch !== undefined) set.branch = String(body.branch || '').trim().slice(0, 120);

  const merged = { ...existing, ...set };
  if (merged.pricingMode === 'gram') {
    if (!merged.metal) throw badRequest('Gram fiyatlı ürün için maden (XAU/XAG) seçilmelidir');
    if (!merged.purity) throw badRequest('Gram fiyatlı ürün için saflık / ayar girilmelidir');
    if (!merged.weight || Number(merged.weight) <= 0) throw badRequest('Gram fiyatlı ürün için gramaj girilmelidir');
  }
  return set;
}

function parseCost(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return parseDecimal(value, SCALE.MONEY, { field: 'Maliyet', max: LIMITS.MAX_MONEY_MINOR });
}

function parseStock(value) {
  if (value === undefined) return undefined;
  const stock = Number(value);
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > LIMITS.MAX_QUANTITY * 100) throw badRequest('Stok sıfır veya pozitif bir tam sayı olmalıdır');
  return stock;
}

async function audit(session, ctx, action, product, extra) {
  if (!ctx.userId) return;
  await recordAudit({
    AuditLog, session, actorUserId: ctx.userId, action, resourceType: 'Product', resourceId: product._id, correlationId: ctx.correlationId, ...extra,
  });
}

async function createProduct(ctx, body) {
  let pricing;
  let stock;
  let cost;
  try {
    if (!body || typeof body !== 'object') throw badRequest('İstek gövdesi bir JSON nesnesi olmalıdır');
    pricing = parsePricing(body, {});
    stock = parseStock(body.stock) ?? 0;
    cost = parseCost(body.costPrice);
  } catch (error) {
    throw wrap(error);
  }
  await assertBranchAssignable(ctx, pricing.branch);
  // Stock lives in the product's branch. Opening stock of a product created
  // without one belongs to the creator's branch (the movement claims it), so
  // no units on hand are ever left without an owning branch.
  const branch = pricing.branch || ctx.branch;
  const bctx = { ...ctx, branch };
  await ledger.prepareAccounts(ctx.businessId, [
    { account: ACCOUNTS.inventory(branch), unit: 'TRY' },
    { account: ACCOUNTS.openingEquity, unit: 'TRY' },
  ]);

  return runInTransaction(async (session) => {
    const [product] = await Product.create([{
      ...writableData(Product, body, { extraProtected: SPECIAL_FIELDS }),
      ...pricing,
      businessId: ctx.businessId,
      stock: 0,
      costPrice: cost === undefined || cost === null ? null : toDisplayNumber(cost, 2),
      costPoolMinor: cost === undefined || cost === null ? null : 0,
    }], { session });
    if (stock > 0) {
      const openingCost = cost === undefined || cost === null ? null : cost * BigInt(stock);
      await inventory.moveProduct(session, bctx, {
        product, quantity: stock, movementType: 'opening', costMinor: openingCost,
        reference: { kind: 'Product', id: String(product._id) }, reason: 'Açılış stoğu',
      });
      if (openingCost && openingCost > 0n) {
        await ledger.postEntry(session, bctx, {
          entryType: 'inventory_opening',
          reference: { kind: 'Product', id: String(product._id) },
          description: `Açılış stoğu: ${product.name}`,
          lines: [debit(ACCOUNTS.inventory(branch), 'TRY', openingCost), credit(ACCOUNTS.openingEquity, 'TRY', openingCost)],
        });
      }
    }
    await audit(session, ctx, 'product.created', product, { after: { name: product.name, stock, pricingMode: product.pricingMode } });
    return product;
  }).catch((error) => { throw wrap(error); });
}

async function updateProduct(ctx, id, body, { user }) {
  let pricing;
  let stock;
  let cost;
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('İstek gövdesi bir JSON nesnesi olmalıdır');
    stock = parseStock(body.stock);
    cost = parseCost(body.costPrice);
  } catch (error) {
    throw wrap(error);
  }
  const productId = Number(id);
  const existing = await Product.findOne({ _id: productId, businessId: ctx.businessId, isArchived: { $ne: true } }).lean();
  if (!existing) throw notFound('Ürün bulunamadı');
  try {
    pricing = parsePricing(body, existing);
  } catch (error) {
    throw wrap(error);
  }
  await assertBranchAssignable(ctx, pricing.branch);
  // Stock / cost changes are booked to the product's own branch; a shared
  // product without stock is claimed by the branch it is being assigned to
  // in this request, else by the caller's branch.
  const branch = existing.branch || pricing.branch || ctx.branch;
  const bctx = { ...ctx, branch };
  await ledger.prepareAccounts(ctx.businessId, [
    { account: ACCOUNTS.inventory(branch), unit: 'TRY' },
    { account: ACCOUNTS.inventoryAdjustment, unit: 'TRY' },
    { account: ACCOUNTS.revaluation, unit: 'TRY' },
  ]);

  return runInTransaction(async (session) => {
    const product = await inventory.loadProduct(session, ctx, productId);
    if (pricing.branch !== undefined && pricing.branch !== (product.branch || '')
      && ((product.stock || 0) > 0 || inventory.reservedOf(product) > 0)) {
      if (!product.branch) {
        // Legacy stock of unknown ownership: assigning it here would silently
        // move inventory value between branches.
        throw conflict(
          `${product.name}: stoğun hangi şubeye ait olduğu belirlenmemiş; sahipliği stok sahipliği çözümleme prosedürüyle atayın (scripts/resolveStockOwnership.js)`,
          'STOCK_OWNERSHIP_UNRESOLVED',
        );
      }
      // Re-labelling the branch would move stock (and its inventory value)
      // without any movement or journal entry: use a transfer instead.
      throw conflict(
        `${product.name}: stoğu olan ürünün şubesi değiştirilemez; stoğu şubeler arası transfer ile taşıyın`,
        'PRODUCT_BRANCH_HAS_STOCK',
      );
    }
    const reference = { kind: 'Product', id: String(product._id) };
    const plain = writableData(Product, body, { extraProtected: SPECIAL_FIELDS });
    const before = { stock: product.stock, costPrice: product.costPrice, price: product.price };

    const currentCostMinor = product.costPrice === null || product.costPrice === undefined
      ? null : parseDecimal(product.costPrice, SCALE.MONEY, { round: true });
    const costChanged = cost !== undefined && cost !== currentCostMinor;
    const stockChanged = stock !== undefined && stock !== product.stock;
    if ((costChanged || stockChanged) && !hasPermission(user, 'inventory:adjust')) {
      throw forbidden('Stok veya maliyet düzeltmesi için "inventory:adjust" yetkisi gereklidir', 'FORBIDDEN');
    }

    if (costChanged) {
      if (cost === null) throw badRequest('Bilinen maliyet kaldırılamaz; yeni bir maliyet girin');
      const { delta } = await inventory.revalueProduct(session, bctx, { product, unitCostMinor: cost, reason: 'Maliyet düzeltmesi', reference });
      if (delta !== 0n) {
        await ledger.postEntry(session, bctx, {
          entryType: 'inventory_revaluation',
          reference,
          description: `Maliyet düzeltmesi: ${product.name}`,
          lines: delta > 0n
            ? [debit(ACCOUNTS.inventory(branch), 'TRY', delta), credit(ACCOUNTS.revaluation, 'TRY', delta)]
            : [debit(ACCOUNTS.revaluation, 'TRY', -delta), credit(ACCOUNTS.inventory(branch), 'TRY', -delta)],
        });
      }
    }

    if (stockChanged) {
      const delta = stock - product.stock;
      const pool = inventory.effectivePool(product);
      // Additional units are valued at the current average cost (or the new cost).
      let incomingCost = null;
      if (delta > 0) {
        const unit = pool !== null && product.stock > 0
          ? inventory.issueCost(pool, product.stock, 1)
          : (cost ?? currentCostMinor);
        incomingCost = unit === null || unit === undefined ? null : BigInt(unit) * BigInt(delta);
      }
      const moved = await inventory.moveProduct(session, bctx, {
        product, quantity: delta, movementType: 'adjustment', costMinor: incomingCost, reference,
        reason: typeof body.adjustmentReason === 'string' ? body.adjustmentReason.slice(0, 300) : 'Stok sayım düzeltmesi',
      });
      if (moved.costMinor && moved.costMinor > 0n) {
        await ledger.postEntry(session, bctx, {
          entryType: 'inventory_adjustment',
          reference,
          description: `Stok düzeltmesi: ${product.name} (${delta > 0 ? '+' : ''}${delta})`,
          lines: delta > 0
            ? [debit(ACCOUNTS.inventory(branch), 'TRY', moved.costMinor), credit(ACCOUNTS.inventoryAdjustment, 'TRY', moved.costMinor)]
            : [debit(ACCOUNTS.inventoryAdjustment, 'TRY', moved.costMinor), credit(ACCOUNTS.inventory(branch), 'TRY', moved.costMinor)],
        });
      }
    }

    const set = { ...plain, ...pricing };
    if (set.branch !== undefined && set.branch !== (product.branch || '') && (product.stock || 0) > 0) {
      // The stock booked above belongs to product.branch; the label must follow it.
      throw conflict(`${product.name}: stoğu olan ürünün şubesi değiştirilemez`, 'PRODUCT_BRANCH_HAS_STOCK');
    }
    if (Object.keys(set).length) {
      await Product.updateOne({ _id: product._id, businessId: ctx.businessId }, { $set: set }, { session, runValidators: true });
    } else if (!costChanged && !stockChanged) {
      throw badRequest('Güncellenecek geçerli alan bulunamadı');
    }
    const updated = await Product.findOne({ _id: product._id, businessId: ctx.businessId }).session(session);
    await audit(session, ctx, 'product.updated', updated, {
      before,
      after: { stock: updated.stock, costPrice: updated.costPrice, price: updated.price, fields: Object.keys(set) },
    });
    return updated;
  }).catch((error) => { throw wrap(error); });
}

module.exports = { createProduct, updateProduct, parsePricing };
