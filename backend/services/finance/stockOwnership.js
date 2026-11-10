/**
 * Stock ownership resolution for legacy and mis-booked inventory.
 *
 * Invariant (enforced for every new movement by inventoryService.moveProduct):
 * the units on hand of a product belong to exactly one branch — the
 * product's `branch` — and every stock movement and every inventory:{branch}
 * posting for that product is booked to that branch.
 *
 * Legacy data can violate it in three ways:
 *   needs_opening     stock without any movement (pre-ledger record)
 *   needs_assignment  stock on a product without a branch (shared item)
 *   needs_reclass     movements / inventory value booked to a branch other
 *                     than the owner (e.g. the earlier start-up migration
 *                     booked every opening to the default branch, or a
 *                     cross-branch sale/return booked to the admin's branch)
 *
 * The owner of a product is determined, in this order, from:
 *   product_branch          the product's own branch (authoritative)
 *   explicit                an operator resolution { productId: branch }
 *   single_branch_business  the business has (had) exactly one branch
 *   movement_custody        every movement of the product was booked by one
 *                           branch through the application (no migration guess)
 * Anything else is AMBIGUOUS: it is reported and the stock stays frozen
 * (STOCK_OWNERSHIP_UNRESOLVED) until an operator resolves it. Nothing is
 * ever assigned to the default branch merely because it is the default.
 *
 * Applying a resolution never changes quantities, purity or cost: it adds
 * an opening movement / journal entry, sets the product's branch, and moves
 * the net quantity and cost booked to foreign branches into the owner with
 * paired 'ownership_reclass' movements and one balanced journal entry per
 * foreign branch (Dr inventory:{owner} / Cr inventory:{foreign}). Every
 * product is applied in its own transaction and re-analysed inside it, so
 * re-running is a no-op and concurrent runs cannot double-post.
 */
const mongoose = require('mongoose');
const Product = require('../../models/Product');
const StockMovement = require('../../models/StockMovement');
const { DEFAULT_BRANCH } = require('../../config/tenancy');
const { parseDecimal, toSafeInteger, toDisplayNumber } = require('../../domain/decimal');
const ledger = require('./ledgerService');
const { systemContext, runInTransaction } = require('./core');
const { listBranches } = require('./branchDirectory');

const { ACCOUNTS, debit, credit } = ledger;

const BRANCH_SOURCES = [
  ['users', 'branch'], ['products', 'branch'], ['sales', 'branch'], ['cashtransactions', 'branch'],
  ['dailyclosings', 'branch'], ['purchases', 'branch'], ['metal_stocks', 'branch'],
  ['stocktransfers', 'sourceBranch'], ['stocktransfers', 'destinationBranch'],
];

/**
 * Every branch the business has ever used. Movements written by the earlier
 * start-up migration ('opening_migration') are NOT evidence: that code put
 * every opening into the default branch without looking.
 */
async function knownBranches(businessId) {
  const db = mongoose.connection.db;
  const names = new Set();
  for (const [collection, field] of BRANCH_SOURCES) {
    const values = await db.collection(collection).distinct(field, { businessId }).catch(() => []);
    for (const v of values) if (typeof v === 'string' && v.trim()) names.add(v.trim());
  }
  const moved = await StockMovement.distinct('branch', { businessId, movementType: { $ne: 'opening_migration' } });
  for (const v of moved) if (typeof v === 'string' && v.trim()) names.add(v.trim());
  return [...names].sort((a, b) => a.localeCompare(b, 'tr'));
}

function legacyPool(product) {
  if (product.costPoolMinor !== null && product.costPoolMinor !== undefined) return BigInt(product.costPoolMinor);
  const cost = product.costPrice;
  if (cost === null || cost === undefined || !Number.isFinite(Number(cost)) || Number(cost) < 0) return null;
  return parseDecimal(Number(cost), 2, { round: true }) * BigInt(product.stock || 0);
}

/** Per-branch movement totals of every product of a business: Map<productId, Map<branch, totals>>. */
async function movementTotals(businessId, { productId, session } = {}) {
  const match = { businessId, itemType: 'product', ...(productId !== undefined ? { productId } : {}) };
  const rows = await StockMovement.aggregate([
    { $match: match },
    { $group: {
      _id: { productId: '$productId', branch: '$branch' },
      quantity: { $sum: '$quantity' },
      cost: { $sum: { $ifNull: ['$costMinor', 0] } },
      count: { $sum: 1 },
      migrationGuesses: { $sum: { $cond: [{ $eq: ['$movementType', 'opening_migration'] }, 1, 0] } },
    } },
  ]).session(session || null);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r._id.productId)) out.set(r._id.productId, new Map());
    out.get(r._id.productId).set(r._id.branch, { quantity: r.quantity, cost: BigInt(r.cost), count: r.count, migrationGuesses: r.migrationGuesses });
  }
  return out;
}

/**
 * Pure analysis of one product. `branches` = Map<branch, totals> of its
 * movements, `known` = knownBranches(business), `explicit` = operator choice.
 */
function analyzeProduct(product, branches = new Map(), { known = [], explicit } = {}) {
  const stock = product.stock ?? 0;
  const base = { productId: product._id, name: product.name, branch: product.branch || '', stock };
  if (!Number.isSafeInteger(stock) || stock < 0) return { ...base, status: 'invalid_stock', actions: [] };

  const rows = [...branches.entries()].map(([branch, t]) => ({ branch, ...t }));
  const hasMovements = rows.length > 0;
  const movedQuantity = rows.reduce((s, r) => s + r.quantity, 0);
  if (hasMovements && movedQuantity !== stock) {
    // Projection disagrees with its own movements: reconciliation reports it; never touched here.
    return { ...base, status: 'inconsistent', movedQuantity, actions: [] };
  }

  let owner = null;
  let basis = null;
  if (product.branch) {
    owner = product.branch;
    basis = 'product_branch';
    if (explicit && explicit !== owner) {
      return {
        ...base, status: 'conflict', requested: explicit, actions: [],
        detail: 'Ürünün kayıtlı şubesi farklı; stok başka şubeye ancak transferle taşınabilir',
      };
    }
  } else if (explicit) {
    owner = explicit;
    basis = 'explicit';
  } else if (known.length <= 1) {
    owner = known[0] || DEFAULT_BRANCH;
    basis = 'single_branch_business';
  } else if (hasMovements && rows.every((r) => r.migrationGuesses === 0) && rows.length === 1) {
    owner = rows[0].branch;
    basis = 'movement_custody';
  }

  const foreignOf = (o) => rows.filter((r) => r.branch !== o && (r.quantity !== 0 || r.cost !== 0n));

  if (!owner) {
    if (stock === 0) {
      // A shared item without stock needs no owner — but value booked to
      // different branches must still net out (pivot: any branch with a balance).
      const unbalanced = rows.filter((r) => r.quantity !== 0 || r.cost !== 0n);
      if (!unbalanced.length) return { ...base, status: 'ok', owner: null, basis: null, actions: [] };
      const pivot = unbalanced[0].branch;
      return {
        ...base, status: 'needs_reclass', owner: pivot, basis: 'zero_stock_netting', assignBranch: false,
        foreign: foreignOf(pivot).map(view), actions: ['reclass'],
      };
    }
    return {
      ...base,
      status: 'ambiguous',
      actions: [],
      evidence: { knownBranches: known, movements: rows.map(view) },
      detail: 'Birden fazla şube var ve stoğun hangi şubede olduğu kayıtlardan kesin olarak belirlenemiyor; açık çözümleme gerekli',
    };
  }

  const actions = [];
  const needsOpening = !hasMovements && stock > 0;
  const assignBranch = !product.branch && stock > 0;
  const foreign = foreignOf(owner);
  if (needsOpening) actions.push('opening');
  if (assignBranch) actions.push('assign');
  if (foreign.length) actions.push('reclass');
  let status = 'ok';
  if (foreign.length) status = 'needs_reclass';
  else if (needsOpening) status = 'needs_opening';
  else if (assignBranch) status = 'needs_assignment';
  return {
    ...base, status, owner, basis, assignBranch, foreign: foreign.map(view), actions,
    ...(needsOpening ? { openingCostMinor: (() => { const p = legacyPool(product); return p === null ? null : Number(p); })() } : {}),
  };
}

function view(r) {
  return { branch: r.branch, quantity: r.quantity, costMinor: Number(r.cost), costTry: toDisplayNumber(r.cost, 2), movements: r.count };
}

/** Automatic (start-up) work never re-books existing postings: opening + assignment only. */
function autoApplicable(a) {
  return (a.status === 'needs_opening' || a.status === 'needs_assignment') && a.basis !== 'explicit';
}

const PROJECTION = { _id: 1, businessId: 1, name: 1, stock: 1, costPrice: 1, costPoolMinor: 1, branch: 1 };

/**
 * READ-ONLY plan for one business (or all). `resolutions` maps productId →
 * branch (explicit operator decisions; validated against active branches).
 */
async function planStockOwnership({ businessId, resolutions = {} } = {}) {
  const businesses = businessId ? [businessId] : (await Product.collection.distinct('businessId')).filter(Boolean);
  const report = { generatedAt: new Date().toISOString(), businesses: [] };
  for (const biz of businesses) {
    const [known, active, totals, products] = await Promise.all([
      knownBranches(biz), listBranches(biz), movementTotals(biz),
      Product.collection.find({ businessId: biz }, { projection: PROJECTION }).toArray(),
    ]);
    const summary = {
      businessId: biz, knownBranches: known, activeBranches: active, counts: {}, products: [], invalidResolutions: [],
    };
    for (const product of products) {
      const explicit = resolutions[String(product._id)];
      if (explicit !== undefined && (typeof explicit !== 'string' || !active.includes(explicit))) {
        summary.invalidResolutions.push({ productId: product._id, requested: explicit, reason: 'Aktif bir şube değil' });
        continue;
      }
      const a = analyzeProduct(product, totals.get(product._id), { known, explicit });
      summary.counts[a.status] = (summary.counts[a.status] || 0) + 1;
      if (a.status !== 'ok') summary.products.push(a);
    }
    report.businesses.push(summary);
  }
  report.pendingAuto = report.businesses.some((b) => b.products.some(autoApplicable));
  report.needsOperator = report.businesses.some((b) => b.invalidResolutions.length
    || b.products.some((a) => ['ambiguous', 'conflict', 'needs_reclass', 'inconsistent', 'invalid_stock'].includes(a.status)
      || (a.basis === 'explicit' && a.status !== 'ok')));
  return report;
}

/**
 * Applies the resolution of ONE product in its own transaction, re-analysing
 * inside it. `mode`: 'auto' (opening + assignment only) or 'operator'
 * (also reclass and explicit resolutions). Returns the analysis applied, or
 * null when nothing was done.
 */
async function applyProduct(businessId, productId, { mode = 'auto', explicit, known } = {}) {
  const knownList = known || await knownBranches(businessId);
  // Accounts must exist before the transaction (ledger contract).
  const preview = await Product.collection.findOne({ _id: productId, businessId }, { projection: PROJECTION });
  if (!preview) return null;
  const previewAnalysis = analyzeProduct(preview, (await movementTotals(businessId, { productId })).get(productId), { known: knownList, explicit });
  if (!previewAnalysis.actions?.length) return null;
  if (mode === 'auto' && !autoApplicable(previewAnalysis)) return null;
  const accounts = [{ account: ACCOUNTS.inventory(previewAnalysis.owner), unit: 'TRY' }, { account: ACCOUNTS.openingEquity, unit: 'TRY' }];
  for (const f of previewAnalysis.foreign || []) accounts.push({ account: ACCOUNTS.inventory(f.branch), unit: 'TRY' });
  await ledger.prepareAccounts(businessId, accounts);

  try {
    return await runInTransaction(async (session) => {
      const product = await Product.collection.findOne({ _id: productId, businessId }, { projection: PROJECTION, session });
      const totals = (await movementTotals(businessId, { productId, session })).get(productId);
      const a = analyzeProduct(product, totals, { known: knownList, explicit });
      if (!a.actions?.length || (mode === 'auto' && !autoApplicable(a))) return null;
      if (a.owner !== previewAnalysis.owner) throw Object.assign(new Error('Ownership changed concurrently'), { code: 'OWNERSHIP_CHANGED' });
      const ctx = systemContext({ businessId, branch: a.owner, correlationId: `stock-ownership:${mode}` });
      const reference = { kind: 'Product', id: String(productId) };
      const generation = [...(totals?.values() || [])].reduce((s, t) => s + t.count, 0);

      if (a.actions.includes('opening')) {
        const pool = legacyPool(product);
        await StockMovement.create([{
          businessId,
          branch: a.owner,
          itemType: 'product',
          productId,
          movementType: 'opening_migration',
          quantity: product.stock,
          costMinor: pool === null ? null : toSafeInteger(pool),
          balanceAfter: product.stock,
          reference,
          reason: `Mevcut stoğun yeni stok defterine aktarımı (şube: ${a.owner}, dayanak: ${a.basis})`,
          externalKey: `opening:${productId}`,
        }], { session });
        if (pool !== null && pool > 0n) {
          await ledger.postEntry(session, ctx, {
            entryType: 'opening_migration',
            reference,
            description: `Açılış stoğu (aktarım): ${product.name}`,
            externalKey: `inventory-opening:${productId}`,
            lines: [debit(ACCOUNTS.inventory(a.owner), 'TRY', pool), credit(ACCOUNTS.openingEquity, 'TRY', pool)],
            branch: a.owner,
          });
        }
        if ((product.costPoolMinor === null || product.costPoolMinor === undefined) && pool !== null) {
          await Product.collection.updateOne({ _id: productId, businessId, costPoolMinor: product.costPoolMinor ?? null }, { $set: { costPoolMinor: toSafeInteger(pool) } }, { session });
        }
      }

      for (const f of a.foreign || []) {
        const cost = BigInt(f.costMinor);
        const key = `ownership:${productId}:${generation}:${f.branch}`;
        await StockMovement.create([
          {
            businessId, branch: f.branch, itemType: 'product', productId, movementType: 'ownership_reclass',
            quantity: -f.quantity, costMinor: toSafeInteger(-cost), balanceAfter: product.stock, reference,
            reason: `Stok sahipliği düzeltmesi: ${f.branch} → ${a.owner}`, externalKey: `${key}:out`,
          },
          {
            businessId, branch: a.owner, itemType: 'product', productId, movementType: 'ownership_reclass',
            quantity: f.quantity, costMinor: toSafeInteger(cost), balanceAfter: product.stock, reference,
            reason: `Stok sahipliği düzeltmesi: ${f.branch} → ${a.owner}`, externalKey: `${key}:in`,
          },
        ], { session, ordered: true });
        if (cost !== 0n) {
          await ledger.postEntry(session, ctx, {
            entryType: 'inventory_ownership_reclass',
            reference,
            description: `Stok sahipliği düzeltmesi: ${product.name} (${f.branch} → ${a.owner})`,
            externalKey: key,
            branch: a.owner,
            lines: cost > 0n
              ? [debit(ACCOUNTS.inventory(a.owner), 'TRY', cost), credit(ACCOUNTS.inventory(f.branch), 'TRY', cost)]
              : [debit(ACCOUNTS.inventory(f.branch), 'TRY', -cost), credit(ACCOUNTS.inventory(a.owner), 'TRY', -cost)],
          });
        }
      }

      if (a.assignBranch) {
        const res = await Product.collection.updateOne(
          { _id: productId, businessId, stock: product.stock, branch: { $in: ['', null] } },
          { $set: { branch: a.owner } },
          { session },
        );
        if (res.matchedCount !== 1) throw Object.assign(new Error('Product changed concurrently'), { code: 'OWNERSHIP_CHANGED' });
      }
      return a;
    });
  } catch (error) {
    if (error?.code === 11000) return null; // applied by a concurrent run
    throw error;
  }
}

module.exports = {
  knownBranches,
  movementTotals,
  analyzeProduct,
  autoApplicable,
  planStockOwnership,
  applyProduct,
};
