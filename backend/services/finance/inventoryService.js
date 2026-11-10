/**
 * Inventory engine.
 *
 * Products: Product.stock (pieces) and Product.costPoolMinor (total cost of
 * the units on hand, kuruş) are projections of StockMovement documents.
 * Cost method: weighted average over an exact cost pool — issuing q of n
 * units removes round(pool × q / n); issuing the last unit removes the whole
 * remainder, so the pool never drifts from Σ movement costs.
 *
 * Metal pools (MetalStock): bulk gold/silver per branch, metal and purity
 * with weight, fine content and cost pool, same rules.
 *
 * Negative stock is never allowed: every outgoing movement is a conditional
 * update guarded by the available quantity, inside the caller's transaction.
 */
const Product = require('../../models/Product');
const StockMovement = require('../../models/StockMovement');
const MetalStock = require('../../models/MetalStock');
const AccountBalance = require('../../models/AccountBalance');
const { roundDiv, toSafeInteger, toDisplayNumber, parseDecimal } = require('../../domain/decimal');
const { ROUNDING_MODE } = require('../../domain/precision');
const { conflict, notFound, forbidden, unprocessable } = require('./core');

/** Cost removed when issuing `quantity` units out of `stock` with `pool` (BigInt|null). */
function issueCost(pool, stock, quantity) {
  if (pool === null || pool === undefined) return null;
  const p = BigInt(pool);
  if (quantity >= stock) return p;
  return roundDiv(p * BigInt(quantity), BigInt(stock), ROUNDING_MODE);
}

/**
 * Cost pool of a product as BigInt (or null = unknown). Legacy products
 * carry only a recorded unit cost (`costPrice`); their pool is exactly
 * stock × costPrice (the same rule the start-up migration persists).
 */
function effectivePool(product) {
  if (product.costPoolMinor !== null && product.costPoolMinor !== undefined) return BigInt(product.costPoolMinor);
  if (product.costPrice === null || product.costPrice === undefined) return null;
  const unit = parseDecimal(product.costPrice, 2, { field: 'Ürün maliyeti', round: true });
  return unit * BigInt(product.stock || 0);
}

function displayUnitCost(pool, stock, fallback) {
  if (pool === null || pool === undefined) return null;
  if (stock <= 0) return fallback ?? null; // keep the last known unit cost for an empty item
  return toDisplayNumber(roundDiv(BigInt(pool), BigInt(stock), ROUNDING_MODE), 2);
}

const reservedOf = (doc) => Number(doc?.reservedStock || 0);
// Legacy documents have no reservedStock field: 0 must also match "missing".
const reservedFilter = (reserved) => (reserved === 0 ? { reservedStock: { $in: [0, null] } } : { reservedStock: reserved });

/**
 * Reserves `quantity` free units of a product for an approved transfer.
 * The units stay in stock (and in the cost pool) but can no longer be sold,
 * adjusted away or returned until the reservation is consumed (dispatch) or
 * released (cancellation).
 */
async function reserveProduct(session, ctx, { product, quantity }) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Reservation quantity must be a positive integer');
  const stock = product.stock || 0;
  const reserved = reservedOf(product);
  if (stock - reserved < quantity) {
    throw conflict(`Yetersiz serbest stok: ${product.name} (mevcut ${stock}, ayrılmış ${reserved}, istenen ${quantity})`, 'INSUFFICIENT_STOCK', {
      productId: product._id, stock, reserved, requested: quantity,
    });
  }
  const result = await Product.updateOne(
    { _id: product._id, businessId: ctx.businessId, stock, ...reservedFilter(reserved) },
    { $set: { reservedStock: reserved + quantity } },
    { session },
  );
  if (result.matchedCount !== 1) throw conflict('Ürün stoğu bu işlem sırasında değişti; lütfen tekrar deneyin', 'STOCK_CHANGED');
  product.reservedStock = reserved + quantity;
}

/** Releases a reservation made by reserveProduct (transfer cancelled). */
async function releaseProduct(session, ctx, { product, quantity }) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Reservation quantity must be a positive integer');
  const reserved = reservedOf(product);
  if (reserved < quantity) throw conflict(`${product.name}: serbest bırakılacak rezervasyon bulunamadı`, 'RESERVATION_CHANGED');
  const result = await Product.updateOne(
    { _id: product._id, businessId: ctx.businessId, ...reservedFilter(reserved) },
    { $set: { reservedStock: reserved - quantity } },
    { session },
  );
  if (result.matchedCount !== 1) throw conflict('Ürün stoğu bu işlem sırasında değişti; lütfen tekrar deneyin', 'STOCK_CHANGED');
  product.reservedStock = reserved - quantity;
}

/**
 * Stock ownership invariant: units on hand always belong to exactly one
 * branch — the product's `branch`. Every movement must be booked to that
 * branch, so a branch can never change another branch's stock or the value
 * of another branch's `inventory:{branch}` account.
 *
 *   product.branch set           → the movement branch must equal it
 *   no branch, stock 0           → the first incoming movement claims the
 *                                  product for the movement branch
 *   no branch, stock > 0         → legacy stock of unresolved ownership:
 *                                  refused until it is resolved
 *                                  (scripts/resolveStockOwnership.js)
 *
 * Returns the branch that owns the movement and whether it claims the product.
 */
function assertStockOwner(product, branch, quantity = 0) {
  const owner = product.branch || '';
  if (!branch) throw new Error('A stock movement needs a branch');
  if (owner) {
    if (owner !== branch) {
      throw conflict(
        `${product.name}: ürün ${owner} şubesinin stoğunda; ${branch} şubesi adına stok hareketi yapılamaz`,
        'BRANCH_OWNERSHIP_MISMATCH',
        { productId: product._id, productBranch: owner, requestedBranch: branch },
      );
    }
    return { owner, claim: false };
  }
  if ((product.stock || 0) > 0) {
    throw conflict(
      `${product.name}: stoğun hangi şubeye ait olduğu belirlenmemiş (eski kayıt). `
      + 'Önce stok sahipliğini çözümleyin (scripts/resolveStockOwnership.js).',
      'STOCK_OWNERSHIP_UNRESOLVED',
      { productId: product._id, stock: product.stock },
    );
  }
  return { owner: branch, claim: quantity > 0 };
}

/**
 * Branch of a sale / purchase / return document for the given products.
 *  - every branch-bound product must belong to one and the same branch
 *  - the document branch is the explicitly requested one, else the caller's
 *  - a document in another branch than the caller's is an explicit,
 *    admin-only cross-branch operation: the admin must name the branch
 *    (`branch` in the payload) and it must be an active branch
 * Never derived silently from the admin's own branch when the stock is elsewhere.
 */
async function resolveDocumentBranch(ctx, products, requestedBranch, { assertBranch }) {
  const requested = typeof requestedBranch === 'string' ? requestedBranch.trim() : '';
  if (requestedBranch !== undefined && requestedBranch !== null && typeof requestedBranch !== 'string') {
    throw unprocessable('branch bir metin olmalıdır', 'INVALID_BRANCH');
  }
  if (requested && requested !== ctx.branch) {
    if (!ctx.isAdmin) throw forbidden('Yalnızca kendi şubeniz adına işlem yapabilirsiniz', 'BRANCH_MISMATCH');
    await assertBranch(ctx.businessId, requested);
  }
  const owners = [...new Set(products.map((p) => p.branch).filter(Boolean))];
  if (owners.length > 1) {
    throw conflict(`Belgedeki ürünler farklı şubelere ait (${owners.join(', ')}); her şube için ayrı belge oluşturun`, 'MIXED_BRANCH_DOCUMENT', { branches: owners });
  }
  const target = requested || ctx.branch;
  const [owner] = owners;
  if (owner && owner !== target) {
    if (!ctx.isAdmin) throw forbidden('Bu ürün başka bir şubenin stoğunda', 'BRANCH_MISMATCH');
    if (!requested) {
      throw conflict(
        `Ürünler ${owner} şubesinin stoğunda. Başka şube adına işlem için şubeyi açıkça seçin (branch: "${owner}").`,
        'CROSS_BRANCH_CONFIRMATION_REQUIRED',
        { productBranch: owner, yourBranch: ctx.branch },
      );
    }
    throw conflict(`Ürünler ${owner} şubesinin stoğunda, seçilen şube ${target} değil`, 'BRANCH_OWNERSHIP_MISMATCH', { productBranch: owner, requestedBranch: target });
  }
  return target;
}

/** Loads a product of the tenant inside `session` and enforces branch scope. */
async function loadProduct(session, ctx, productId, { allowArchived = false } = {}) {
  const filter = { _id: productId, businessId: ctx.businessId };
  if (!allowArchived) filter.isArchived = { $ne: true };
  const product = await Product.findOne(filter).session(session);
  if (!product) throw notFound('Ürün bulunamadı', 'PRODUCT_NOT_FOUND');
  if (product.branch && product.branch !== ctx.branch && !ctx.isAdmin) {
    throw forbidden('Bu ürün başka bir şubenin stoğunda', 'BRANCH_MISMATCH');
  }
  return product;
}

/**
 * One product document per id for the lifetime of a single command.
 *
 * A command that loads ALL its products before moving any stock (a sale
 * prices every line first, then moves stock) must give lines of the same
 * product the SAME document: moveProduct updates it in place, so a later
 * line sees the stock and cost pool left by the earlier ones. Loading a
 * separate copy per line gives the later line a stale snapshot, whose
 * optimistic guard (stock / costPoolMinor) can never match.
 * (Loops that load a product right before moving it already read their own
 * writes inside the transaction and do not need this.)
 *
 *   load(id, { allowArchived }) → like loadProduct (tenant + branch scope)
 */
function productLoader(session, ctx) {
  const cache = new Map();
  return {
    async load(productId, { allowArchived = false } = {}) {
      const key = String(productId);
      const cached = cache.get(key);
      if (cached) {
        if (!allowArchived && cached.isArchived) throw notFound('Ürün bulunamadı', 'PRODUCT_NOT_FOUND');
        return cached;
      }
      const product = await loadProduct(session, ctx, productId, { allowArchived });
      cache.set(key, product);
      return product;
    },
  };
}

/**
 * Applies a signed quantity movement to a product.
 * - negative quantity: cost leaves the pool at weighted average; returns that cost
 * - positive quantity: `costMinor` (BigInt|null) enters the pool
 * Returns { movement, costMinor (BigInt|null), product }.
 */
async function moveProduct(session, ctx, {
  product, quantity, movementType, costMinor = null, reference, reason, externalKey, branch,
  // Outgoing only: units of this movement that consume an existing transfer reservation.
  consumeReservation = 0,
}) {
  if (!Number.isSafeInteger(quantity) || quantity === 0) throw new Error('Stock movement quantity must be a non-zero integer');
  if (!Number.isSafeInteger(consumeReservation) || consumeReservation < 0 || (consumeReservation > 0 && consumeReservation > -quantity)) {
    throw new Error('consumeReservation must be a non-negative integer not larger than the outgoing quantity');
  }
  const movementBranch = branch || ctx.branch;
  const { claim } = assertStockOwner(product, movementBranch, quantity);
  const stock = product.stock || 0;
  const reserved = reservedOf(product);
  if (consumeReservation > reserved) throw conflict(`${product.name}: rezerve stok bu işlem sırasında değişti`, 'RESERVATION_CHANGED');
  const pool = effectivePool(product);
  let movementCost;
  let newPool;

  if (quantity < 0) {
    const out = -quantity;
    const free = stock - reserved + consumeReservation;
    if (free < out) {
      const detail = reserved > 0 ? `, transfer için ayrılan ${reserved}` : '';
      throw conflict(`Yetersiz stok: ${product.name} (mevcut ${stock}${detail}, istenen ${out})`, 'INSUFFICIENT_STOCK', {
        productId: product._id, stock, reserved, requested: out,
      });
    }
    const cost = issueCost(pool, stock, out);
    movementCost = cost === null ? null : -cost;
    newPool = pool === null ? null : pool - cost;
  } else {
    if (costMinor === null) {
      // Unknown incoming cost keeps the pool unknown only when nothing of known cost is on hand.
      if (pool !== null && stock > 0) {
        throw unprocessable(`${product.name}: maliyeti bilinen stoğa maliyetsiz giriş yapılamaz`, 'COST_REQUIRED');
      }
      movementCost = null;
      newPool = stock === 0 ? null : pool;
    } else {
      if (pool === null && stock > 0) {
        throw unprocessable(`${product.name}: mevcut stoğun maliyeti bilinmiyor; önce maliyet düzeltmesi yapın`, 'UNKNOWN_EXISTING_COST');
      }
      movementCost = BigInt(costMinor);
      newPool = (pool || 0n) + movementCost;
    }
  }

  const newStock = stock + quantity;
  const update = {
    $inc: { stock: quantity, ...(consumeReservation ? { reservedStock: -consumeReservation } : {}) },
    $set: {
      costPoolMinor: newPool === null ? null : toSafeInteger(newPool),
      costPrice: newPool === null ? (stock + quantity === 0 ? product.costPrice : null) : displayUnitCost(newPool, newStock, product.costPrice),
      // First stock of a shared catalogue item: it now belongs to this branch.
      ...(claim ? { branch: movementBranch } : {}),
    },
  };
  // Optimistic guard on the exact state read in this transaction (including
  // the owning branch, so a concurrent claim or re-labelling cannot slip in).
  const result = await Product.updateOne(
    {
      _id: product._id,
      businessId: ctx.businessId,
      stock,
      costPoolMinor: product.costPoolMinor ?? null,
      ...reservedFilter(reserved),
      ...(product.branch ? { branch: product.branch } : { branch: { $in: ['', null] } }),
    },
    update,
    { session },
  );
  if (result.matchedCount !== 1) throw conflict('Ürün stoğu bu işlem sırasında değişti; lütfen tekrar deneyin', 'STOCK_CHANGED');
  if (claim) product.branch = movementBranch;

  const [movement] = await StockMovement.create([{
    businessId: ctx.businessId,
    branch: movementBranch,
    itemType: 'product',
    productId: product._id,
    movementType,
    quantity,
    weightMg: 0,
    fineMg: 0,
    costMinor: movementCost === null ? null : toSafeInteger(movementCost),
    balanceAfter: newStock,
    reference,
    reason,
    externalKey,
    createdBy: ctx.userId || null,
    correlationId: ctx.correlationId,
  }], { session });

  product.stock = newStock;
  if (consumeReservation) product.reservedStock = reserved - consumeReservation;
  product.costPoolMinor = update.$set.costPoolMinor;
  product.costPrice = update.$set.costPrice;
  return { movement, costMinor: movementCost === null ? null : (movementCost < 0n ? -movementCost : movementCost), product };
}

/**
 * Sets a new unit cost for the units on hand (maliyet düzeltmesi):
 * pool := stock × unitCost. Returns the pool delta (BigInt) so the caller
 * can post the matching revaluation entry. Recorded as a 'revaluation'
 * movement (quantity 0).
 */
async function revalueProduct(session, ctx, { product, unitCostMinor, reason, reference, branch }) {
  const movementBranch = branch || ctx.branch;
  if ((product.stock || 0) > 0 || product.branch) assertStockOwner(product, movementBranch, 0);
  const stock = product.stock || 0;
  const oldPool = effectivePool(product);
  const newPool = BigInt(unitCostMinor) * BigInt(stock);
  const delta = newPool - (oldPool || 0n);
  const result = await Product.updateOne(
    { _id: product._id, businessId: ctx.businessId, stock, costPoolMinor: product.costPoolMinor ?? null },
    { $set: { costPoolMinor: toSafeInteger(newPool), costPrice: toDisplayNumber(BigInt(unitCostMinor), 2) } },
    { session },
  );
  if (result.matchedCount !== 1) throw conflict('Ürün bu işlem sırasında değişti; lütfen tekrar deneyin', 'STOCK_CHANGED');
  if (stock > 0 || oldPool !== null) {
    await StockMovement.create([{
      businessId: ctx.businessId,
      branch: product.branch || movementBranch,
      itemType: 'product',
      productId: product._id,
      movementType: 'revaluation',
      quantity: 0,
      // Unknown → known: the movement carries the full new pool so Σ movements == pool.
      costMinor: toSafeInteger(oldPool === null ? newPool : delta),
      balanceAfter: stock,
      reference,
      reason,
      createdBy: ctx.userId || null,
      correlationId: ctx.correlationId,
    }], { session });
  }
  product.costPoolMinor = toSafeInteger(newPool);
  product.costPrice = toDisplayNumber(BigInt(unitCostMinor), 2);
  return { delta: oldPool === null ? newPool : delta, previouslyUnknown: oldPool === null };
}

/** Creates the metal pool document outside the transaction (see ledger prepareAccounts). */
async function prepareMetalPool(ctx, { branch, metal, purity }) {
  const b = branch || ctx.branch;
  const _id = MetalStock.idFor(ctx.businessId, b, metal, purity);
  try {
    await MetalStock.updateOne(
      { _id },
      { $setOnInsert: { businessId: ctx.businessId, branch: b, metal, purity: Number(purity), weightMg: 0, fineMg: 0, costPoolMinor: 0, updatedAt: null } },
      { upsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  return _id;
}

/**
 * Signed movement on a metal pool. Positive: weight/fine/cost in. Negative
 * weight: out at weighted-average cost (by fine content).
 * Returns { movement, costMinor (BigInt, absolute) }.
 */
async function moveMetal(session, ctx, {
  branch, metal, purity, weightMg, fineMg, costMinor = 0n, movementType, reference, reason,
  // Outgoing only: { weightMg, fineMg } of this movement that consume a transfer reservation.
  consumeReservation = null,
}) {
  const b = branch || ctx.branch;
  const _id = MetalStock.idFor(ctx.businessId, b, metal, purity);
  const pool = await MetalStock.findById(_id).session(session);
  if (!pool) throw new Error(`Metal pool not prepared: ${_id}`);
  const w = BigInt(weightMg);
  const f = BigInt(fineMg);
  const reservedW = BigInt(pool.reservedWeightMg || 0);
  const reservedF = BigInt(pool.reservedFineMg || 0);
  const consumeW = consumeReservation ? BigInt(consumeReservation.weightMg) : 0n;
  const consumeF = consumeReservation ? BigInt(consumeReservation.fineMg) : 0n;
  if (consumeW > reservedW || consumeF > reservedF) throw conflict('Maden rezervasyonu bu işlem sırasında değişti', 'RESERVATION_CHANGED');
  let cost;
  if (w < 0n) {
    if (BigInt(pool.weightMg) - reservedW + consumeW < -w || BigInt(pool.fineMg) - reservedF + consumeF < -f) {
      throw conflict(
        reservedW > 0n ? 'Maden stoğu yetersiz (bir kısmı şubeler arası transfer için ayrılmış)' : 'Maden stoğu yetersiz',
        'INSUFFICIENT_METAL_STOCK',
      );
    }
    const out = -f;
    cost = out >= BigInt(pool.fineMg) ? BigInt(pool.costPoolMinor) : roundDiv(BigInt(pool.costPoolMinor) * out, BigInt(pool.fineMg), ROUNDING_MODE);
    cost = -cost;
  } else {
    cost = BigInt(costMinor);
  }
  const result = await MetalStock.updateOne(
    { _id, weightMg: pool.weightMg, fineMg: pool.fineMg, costPoolMinor: pool.costPoolMinor },
    {
      $inc: {
        weightMg: toSafeInteger(w),
        fineMg: toSafeInteger(f),
        costPoolMinor: toSafeInteger(cost),
        ...(consumeW || consumeF ? { reservedWeightMg: -toSafeInteger(consumeW), reservedFineMg: -toSafeInteger(consumeF) } : {}),
      },
      $set: { updatedAt: new Date() },
    },
    { session },
  );
  if (result.matchedCount !== 1) throw conflict('Maden stoğu bu işlem sırasında değişti; lütfen tekrar deneyin', 'STOCK_CHANGED');
  const [movement] = await StockMovement.create([{
    businessId: ctx.businessId,
    branch: b,
    itemType: 'metal',
    metal,
    purity: Number(purity),
    movementType,
    quantity: 0,
    weightMg: toSafeInteger(w),
    fineMg: toSafeInteger(f),
    costMinor: toSafeInteger(cost),
    balanceAfter: toSafeInteger(BigInt(pool.fineMg) + f),
    reference,
    reason,
    createdBy: ctx.userId || null,
    correlationId: ctx.correlationId,
  }], { session });
  return { movement, costMinor: cost < 0n ? -cost : cost };
}

/**
 * Reserves (sign +1) or releases (sign -1) metal of a pool for a transfer.
 * Reserved metal stays in the pool but cannot be issued by other movements.
 */
async function reserveMetal(session, ctx, { branch, metal, purity, weightMg, fineMg, sign = 1 }) {
  const _id = MetalStock.idFor(ctx.businessId, branch, metal, purity);
  const pool = await MetalStock.findById(_id).session(session);
  const w = BigInt(weightMg);
  const f = BigInt(fineMg);
  if (w <= 0n || f < 0n) throw new Error('Metal reservation needs a positive weight');
  const reservedW = BigInt(pool?.reservedWeightMg || 0);
  const reservedF = BigInt(pool?.reservedFineMg || 0);
  if (sign > 0) {
    if (!pool || BigInt(pool.weightMg) - reservedW < w || BigInt(pool.fineMg) - reservedF < f) {
      throw conflict('Kaynak şubede yeterli serbest maden stoğu yok', 'INSUFFICIENT_METAL_STOCK', {
        metal,
        purity: Number(purity),
        availableWeightMg: pool ? toSafeInteger(BigInt(pool.weightMg) - reservedW) : 0,
        requestedWeightMg: toSafeInteger(w),
      });
    }
  } else if (!pool || reservedW < w || reservedF < f) {
    throw conflict('Serbest bırakılacak maden rezervasyonu bulunamadı', 'RESERVATION_CHANGED');
  }
  const delta = sign > 0 ? 1n : -1n;
  const result = await MetalStock.updateOne(
    { _id, weightMg: pool.weightMg, fineMg: pool.fineMg, reservedWeightMg: pool.reservedWeightMg ? pool.reservedWeightMg : { $in: [0, null] } },
    { $set: { reservedWeightMg: toSafeInteger(reservedW + delta * w), reservedFineMg: toSafeInteger(reservedF + delta * f), updatedAt: new Date() } },
    { session },
  );
  if (result.matchedCount !== 1) throw conflict('Maden stoğu bu işlem sırasında değişti; lütfen tekrar deneyin', 'STOCK_CHANGED');
}

/**
 * Recomputes every projection from the movements and reports differences.
 * Products with stock but no movement at all are reported as
 * `missing_opening` (legacy data not yet migrated).
 */
async function reconcile(businessId) {
  const discrepancies = [];
  const productTotals = await StockMovement.aggregate([
    { $match: { businessId, itemType: 'product' } },
    { $group: {
      _id: '$productId',
      quantity: { $sum: '$quantity' },
      cost: { $sum: { $ifNull: ['$costMinor', 0] } },
      unknownCost: { $sum: { $cond: [{ $eq: ['$costMinor', null] }, 1, 0] } },
      count: { $sum: 1 },
    } },
  ]);
  const totals = new Map(productTotals.map((t) => [t._id, t]));
  const products = await Product.find({ businessId }).select('_id name stock costPoolMinor reservedStock branch').lean();
  for (const product of products) {
    const t = totals.get(product._id);
    if (!t) {
      if ((product.stock || 0) !== 0) discrepancies.push({ check: 'missing_opening', productId: product._id, name: product.name, stock: product.stock });
      continue;
    }
    if (t.quantity !== (product.stock || 0)) {
      discrepancies.push({ check: 'product_quantity', productId: product._id, name: product.name, stored: product.stock || 0, movements: t.quantity });
    }
    if (product.costPoolMinor !== null && product.costPoolMinor !== undefined && t.unknownCost === 0 && t.cost !== product.costPoolMinor) {
      discrepancies.push({ check: 'product_cost_pool', productId: product._id, name: product.name, stored: product.costPoolMinor, movements: t.cost });
    }
    if (t.quantity < 0) discrepancies.push({ check: 'negative_stock', productId: product._id, quantity: t.quantity });
  }
  for (const product of products) {
    const reserved = reservedOf(product);
    if (reserved < 0 || reserved > (product.stock || 0)) {
      discrepancies.push({ check: 'reservation_exceeds_stock', productId: product._id, name: product.name, stock: product.stock || 0, reserved });
    }
  }

  const metalTotals = await StockMovement.aggregate([
    { $match: { businessId, itemType: 'metal' } },
    { $group: { _id: { branch: '$branch', metal: '$metal', purity: '$purity' }, weightMg: { $sum: '$weightMg' }, fineMg: { $sum: '$fineMg' }, cost: { $sum: '$costMinor' } } },
  ]);
  const pools = await MetalStock.find({ businessId }).lean();
  const poolById = new Map(pools.map((p) => [MetalStock.idFor(businessId, p.branch, p.metal, p.purity), p]));
  for (const m of metalTotals) {
    const id = MetalStock.idFor(businessId, m._id.branch, m._id.metal, m._id.purity);
    const pool = poolById.get(id) || { weightMg: 0, fineMg: 0, costPoolMinor: 0 };
    if (pool.weightMg !== m.weightMg || pool.fineMg !== m.fineMg || pool.costPoolMinor !== m.cost) {
      discrepancies.push({ check: 'metal_pool', pool: id, stored: { weightMg: pool.weightMg, fineMg: pool.fineMg, costMinor: pool.costPoolMinor }, movements: { weightMg: m.weightMg, fineMg: m.fineMg, costMinor: m.cost } });
    }
    poolById.delete(id);
  }
  for (const [id, pool] of poolById) {
    if (pool.weightMg || pool.fineMg || pool.costPoolMinor) discrepancies.push({ check: 'metal_pool', pool: id, stored: pool, movements: null });
  }

  await reconcileBranchOwnership(businessId, products, discrepancies);

  return {
    ok: discrepancies.length === 0,
    checkedAt: new Date().toISOString(),
    productsChecked: products.length,
    metalPoolsChecked: pools.length,
    discrepancies,
  };
}

/**
 * Branch ownership checks (detect cross-branch corruption):
 *  - foreign_branch_stock: a branch-bound product must not hold units booked
 *    to another branch (Σ movement quantity / cost per foreign branch ≠ 0)
 *  - unresolved_ownership: stock of a product without an owning branch
 *  - branch_inventory_value: the general-ledger account inventory:{branch}
 *    equals Σ known movement cost of that branch (products + metal pools),
 *    i.e. the branch's stock sub-ledger agrees with its books.
 */
async function reconcileBranchOwnership(businessId, products, discrepancies) {
  const byProductBranch = await StockMovement.aggregate([
    { $match: { businessId, itemType: 'product' } },
    { $group: { _id: { productId: '$productId', branch: '$branch' }, quantity: { $sum: '$quantity' }, cost: { $sum: { $ifNull: ['$costMinor', 0] } } } },
  ]);
  const productById = new Map(products.map((p) => [p._id, p]));
  for (const row of byProductBranch) {
    const product = productById.get(row._id.productId);
    if (!product?.branch || row._id.branch === product.branch) continue;
    if (row.quantity !== 0 || row.cost !== 0) {
      discrepancies.push({
        check: 'foreign_branch_stock', productId: product._id, name: product.name, productBranch: product.branch, movementBranch: row._id.branch, quantity: row.quantity, costMinor: row.cost,
      });
    }
  }
  for (const product of products) {
    if (!product.branch && (product.stock || 0) > 0) {
      discrepancies.push({ check: 'unresolved_ownership', productId: product._id, name: product.name, stock: product.stock });
    }
  }

  const movementValue = await StockMovement.aggregate([
    { $match: { businessId } },
    { $group: { _id: '$branch', cost: { $sum: { $ifNull: ['$costMinor', 0] } } } },
  ]);
  const accounts = await AccountBalance.find({ businessId, unit: 'TRY', account: /^inventory:/ }).select('account debit credit').lean();
  const books = new Map(accounts.map((a) => [a.account.slice('inventory:'.length), BigInt(a.debit) - BigInt(a.credit)]));
  const stockValue = new Map(movementValue.map((m) => [m._id, BigInt(m.cost)]));
  for (const branch of new Set([...books.keys(), ...stockValue.keys()])) {
    const gl = books.get(branch) || 0n;
    const sub = stockValue.get(branch) || 0n;
    if (gl !== sub) {
      discrepancies.push({ check: 'branch_inventory_value', branch, ledgerMinor: Number(gl), stockMovementsMinor: Number(sub), difference: Number(gl - sub) });
    }
  }
}

/**
 * Inventory valuation.
 *   at cost   — Σ cost pools (exact); items with unknown cost are counted separately
 *   at market — metal pools and gram items valued at the live has buy price,
 *               only when a fresh quote is available (never stale data)
 */
async function valuation(businessId, { metalPrices = {}, branch } = {}) {
  // Optional branch: only the stock owned by that branch (products and pools).
  const branchFilter = branch ? { branch } : {};
  const products = await Product.find({ businessId, isArchived: { $ne: true }, ...branchFilter })
    .select('_id name stock costPoolMinor costPrice pricingMode metal purity weight').lean();
  let costMinor = 0n;
  let unknownCostItems = 0;
  let unknownCostUnits = 0;
  let pieces = 0;
  for (const p of products) {
    pieces += p.stock || 0;
    if (!p.stock) continue;
    const pool = effectivePool(p);
    if (pool === null) {
      unknownCostItems += 1;
      unknownCostUnits += p.stock;
    } else {
      costMinor += pool;
    }
  }
  const pools = await MetalStock.find({ businessId, fineMg: { $gt: 0 }, ...branchFilter }).lean();
  let metalCostMinor = 0n;
  const metal = { XAU: { fineMg: 0n, weightMg: 0n }, XAG: { fineMg: 0n, weightMg: 0n } };
  for (const pool of pools) {
    metalCostMinor += BigInt(pool.costPoolMinor);
    metal[pool.metal].fineMg += BigInt(pool.fineMg);
    metal[pool.metal].weightMg += BigInt(pool.weightMg);
  }
  const market = {};
  for (const code of ['XAU', 'XAG']) {
    const quote = metalPrices[code];
    market[code] = {
      fineGrams: toDisplayNumber(metal[code].fineMg, 3),
      grossGrams: toDisplayNumber(metal[code].weightMg, 3),
      valueTry: quote ? toDisplayNumber(roundDiv(metal[code].fineMg * quote.pricePerGram, 10n ** 5n, ROUNDING_MODE), 2) : null,
      price: quote ? { pricePerGram: quote.pricePerGramText, source: quote.source, sourceTimestamp: quote.sourceTimestamp, side: 'buy' } : null,
      priceUnavailableReason: quote ? null : 'Güncel canlı fiyat yok; piyasa değeri hesaplanmadı',
    };
  }
  return {
    valuedAt: new Date().toISOString(),
    branch: branch || null,
    products: {
      items: products.length,
      pieces,
      costValueTry: toDisplayNumber(costMinor, 2),
      unknownCostItems,
      unknownCostUnits,
    },
    metalPools: { costValueTry: toDisplayNumber(metalCostMinor, 2), market },
    totalCostValueTry: toDisplayNumber(costMinor + metalCostMinor, 2),
  };
}

module.exports = {
  assertStockOwner,
  resolveDocumentBranch,
  issueCost,
  effectivePool,
  reservedOf,
  loadProduct,
  productLoader,
  moveProduct,
  reserveProduct,
  releaseProduct,
  reserveMetal,
  revalueProduct,
  prepareMetalPool,
  moveMetal,
  reconcile,
  valuation,
};
