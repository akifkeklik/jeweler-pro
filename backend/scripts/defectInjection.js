#!/usr/bin/env node
/**
 * Controlled defect injection ("mutation testing" for the critical
 * financial rules). Each mutant changes one line of production code, runs
 * the test file that should catch it, and restores the file. A mutant that
 * SURVIVES (tests still pass) means the tests do not protect that rule.
 *
 *   node scripts/defectInjection.js        → exit 0 when every mutant is killed
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

const MUTANTS = [
  {
    id: 'reservation-ignored-by-sales',
    file: 'services/finance/inventoryService.js',
    from: 'const free = stock - reserved + consumeReservation;',
    to: 'const free = stock + consumeReservation;',
    test: 'test/transfers.test.js',
  },
  {
    id: 'dispatch-does-not-consume-reservation',
    file: 'services/transferService.js',
    from: "consumeReservation: line.quantity, reason: `Transfer → ${transfer.destinationBranch}`,",
    to: "consumeReservation: 0, reason: `Transfer → ${transfer.destinationBranch}`,",
    test: 'test/transfers.test.js',
  },
  {
    id: 'self-approval-allowed',
    file: 'services/transferService.js',
    from: "if (!ctx.isAdmin && transfer.createdBy && ctx.userId && String(transfer.createdBy) === String(ctx.userId)) {",
    to: 'if (false) {',
    test: 'test/transfers.test.js',
  },
  {
    id: 'receipt-cost-not-proportional',
    file: 'services/transferService.js',
    from: 'if (part >= whole) return BigInt(total);',
    to: 'if (part >= whole) return BigInt(total) + 1n;',
    test: 'test/transfers.test.js',
  },
  {
    id: 'purchase-return-ignores-physical-stock',
    file: 'services/purchaseService.js',
    from: '          if (free < quantity) {',
    to: '          if (false) {',
    test: 'test/purchaseReturns.test.js',
  },
  {
    id: 'purchase-return-double-return',
    file: 'services/purchaseService.js',
    from: '          if (quantity <= 0 || quantity > remainingUnits) {',
    to: '          if (quantity <= 0) {',
    test: 'test/purchaseReturns.test.js',
  },
  {
    id: 'commission-not-booked',
    file: 'services/posService.js',
    from: '    if (commissionMinor > 0n) {\n      // eslint-disable-next-line no-await-in-loop\n      commissionEntry',
    to: '    if (false) {\n      // eslint-disable-next-line no-await-in-loop\n      commissionEntry',
    test: 'test/posCommission.test.js',
  },
  {
    id: 'settlement-difference-silently-accepted',
    file: 'services/posService.js',
    from: 'if (difference !== 0n && !resolution) {',
    to: 'if (false) {',
    test: 'test/posCommission.test.js',
  },
  {
    id: 'historical-commission-recalculated',
    file: 'services/posService.js',
    from: "  const rule = provider.rules.find((r) => r.installments === input.installments);",
    to: "  const rule = provider.rules.find((r) => r.installments === input.installments) && provider.rules.map((r) => ({ ...r, ratePpm: r.ratePpm + 100 })).find((r) => r.installments === input.installments);",
    test: 'test/posCommission.test.js',
  },
  /* ---- branch integrity / authorization (test/branchIntegrity.test.js) ---- */
  {
    id: 'sale-booked-to-admin-branch',
    file: 'services/salesService.js',
    from: 'const branch = await inventory.resolveDocumentBranch(ctx, products, payload?.branch, { assertBranch });',
    to: 'const branch = ctx.branch;',
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'sale-return-booked-to-caller-branch',
    file: 'services/salesService.js',
    from: "    // sale's branch — the branch that issued them — never the caller's branch.\n    const branch = preview.branch || ctx.branch;",
    to: "    // sale's branch — the branch that issued them — never the caller's branch.\n    const branch = ctx.branch;",
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'cross-branch-without-explicit-branch',
    file: 'services/finance/inventoryService.js',
    from: '    if (!requested) {\n      throw conflict(',
    to: '    if (false) {\n      throw conflict(',
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'engine-ownership-guard-removed',
    file: 'services/finance/inventoryService.js',
    from: '    if (owner !== branch) {',
    to: '    if (false) {',
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'unresolved-shared-stock-movable',
    file: 'services/finance/inventoryService.js',
    from: "  if ((product.stock || 0) > 0) {\n    throw conflict(\n      `${product.name}: stoğun hangi şubeye ait olduğu belirlenmemiş",
    to: "  if (false) {\n    throw conflict(\n      `${product.name}: stoğun hangi şubeye ait olduğu belirlenmemiş",
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'purchase-detail-not-branch-scoped',
    file: 'routes/purchases.js',
    from: "Purchase.findOne({ _id: id, businessId: ctx.businessId, ...branchScope(ctx) })",
    to: 'Purchase.findOne({ _id: id, businessId: ctx.businessId })',
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'purchase-mutations-not-branch-scoped',
    file: 'services/purchaseService.js',
    from: "  if (!purchase || (!ctx.isAdmin && purchase.branch !== ctx.branch)) throw notFound('Alış bulunamadı', 'PURCHASE_NOT_FOUND');",
    to: "  if (!purchase) throw notFound('Alış bulunamadı', 'PURCHASE_NOT_FOUND');",
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'purchase-goods-to-admin-branch',
    file: 'services/purchaseService.js',
    from: 'const branch = await inventory.resolveDocumentBranch(ctx, products, payload?.branch, { assertBranch });',
    to: 'const branch = ctx.branch;',
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'product-branch-client-trusted',
    file: 'services/catalogService.js',
    from: "  if (!ctx.isAdmin) throw forbidden('Yalnızca kendi şubenize ürün atayabilirsiniz', 'BRANCH_MISMATCH');",
    to: '',
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'ledger-leaks-other-branch-accounts',
    file: 'routes/ledger.js',
    from: 'const visibleAccount = (ctx) => (a) => ctx.isAdmin || [null, ctx.branch].includes(accountBranch(a.account));',
    to: 'const visibleAccount = () => () => true;',
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'migration-defaults-ambiguous-stock',
    file: 'services/finance/stockOwnership.js',
    from: '  } else if (known.length <= 1) {',
    to: '  } else if (true) {',
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'migration-ignores-product-branch',
    file: 'services/finance/stockOwnership.js',
    from: "    owner = product.branch;\n    basis = 'product_branch';",
    to: "    owner = DEFAULT_BRANCH;\n    basis = 'product_branch';",
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'reconcile-misses-foreign-branch-stock',
    file: 'services/finance/inventoryService.js',
    from: '    if (row.quantity !== 0 || row.cost !== 0) {',
    to: '    if (false) {',
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'sale-update-not-branch-scoped',
    file: 'services/salesService.js',
    from: "      if (!current || current.status === 'cancelled' || !visibleTo(ctx, current)) throw httpError('Aktif satış bulunamadı', 404, 'SALE_NOT_FOUND');",
    to: "      if (!current || current.status === 'cancelled') throw httpError('Aktif satış bulunamadı', 404, 'SALE_NOT_FOUND');",
    test: 'test/branchIntegrity.test.js',
  },
  {
    id: 'staff-can-post-party-opening-balance',
    file: 'routes/cash.js',
    from: "if (body.type === 'devir' && (present(body.customerId) || present(body.supplierId)) && !hasPermission(user, 'accounts:manage')) {",
    to: 'if (false) {',
    test: 'test/systemAcceptance.test.js',
  },
  {
    id: 'supplier-voucher-without-purchases-write',
    file: 'routes/cash.js',
    from: "if (present(body.supplierId) && !hasPermission(user, 'purchases:write')) return 'purchases:write';",
    to: '',
    test: 'test/systemAcceptance.test.js',
  },
  {
    id: 'staff-can-change-credit-limit',
    file: 'routes/customers.js',
    from: "  if (hasPermission(req.user, 'accounts:manage')) return;\n  const requested",
    to: '  return;\n  const requested',
    test: 'test/systemAcceptance.test.js',
  },
  {
    id: 'customer-archived-with-open-balance',
    file: 'routes/customers.js',
    from: 'if ((current.balanceTryMinor || 0) !== 0 || (current.balanceGoldMg || 0) !== 0) {',
    to: 'if (false) {',
    test: 'test/systemAcceptance.test.js',
  },
  {
    id: 'closing-silently-uses-own-branch',
    file: 'services/cashService.js',
    from: "  if (!ctx.isAdmin) throw forbidden('Yalnızca kendi şubenizin gün sonunu kapatabilirsiniz', 'BRANCH_MISMATCH');",
    to: '  if (!ctx.isAdmin) return ctx.branch;',
    test: 'test/systemAcceptance.test.js',
  },
  {
    id: 'gold-count-difference-not-posted',
    file: 'services/cashService.js',
    from: '      if (goldDifference !== 0n) {',
    to: '      if (false) {',
    test: 'test/systemAcceptance.test.js',
  },
  {
    id: 'gold-till-not-locked-by-closing',
    file: 'services/finance/ledgerService.js',
    from: 'const isDayLocked = (account) => isCashAccount(account) || isGoldTill(account);',
    to: 'const isDayLocked = (account) => isCashAccount(account);',
    test: 'test/systemAcceptance.test.js',
  },
  {
    id: 'migration-apply-without-duplicate-preflight',
    file: 'scripts/migrateFinancialData.js',
    from: '  if (conflicts.productBarcodes.length || conflicts.dailyClosings.length) {',
    to: '  if (false) {',
    test: 'test/migrationRehearsal.test.js',
  },
  {
    id: 'migration-dry-run-builds-indexes',
    file: 'scripts/migrate.js',
    from: "  mongoose.set('autoIndex', false);\n  mongoose.set('autoCreate', false);\n  await mongoose.connect(uri);",
    to: '  await mongoose.connect(uri);',
    test: 'test/migrationRehearsal.test.js',
  },
  {
    id: 'ownership-tool-false-all-clear-before-migration',
    file: 'scripts/resolveStockOwnership.js',
    from: '    if (untenanted > 0) {',
    to: '    if (false) {',
    test: 'test/migrationRehearsal.test.js',
  },
  {
    id: 'stale-quote-wins-failover',
    file: 'services/marketDataService.js',
    from: '|| (current.isStale && !quote.isStale)',
    to: '|| false',
    test: 'test/marketDataResilience.test.js',
  },
  // ---- PR #8 remediation rules (test/pr8Remediation.test.js)
  {
    id: 'duplicate-sale-lines-load-stale-copies',
    file: 'services/salesService.js',
    from: 'const product = await products.load(line.productId);',
    to: 'const product = await inventory.loadProduct(session, ctx, line.productId);',
    test: 'test/pr8Remediation.test.js',
  },
  {
    id: 'aggregate-stock-of-duplicate-lines-unchecked',
    file: 'services/salesService.js',
    from: 'if (checkStock) assertAggregateStock(priced);',
    to: 'if (false) assertAggregateStock(priced);',
    test: 'test/pr8Remediation.test.js',
  },
  {
    id: 'manual-price-unknown-metal-ignored',
    file: 'services/salesService.js',
    from: "if (!Object.prototype.hasOwnProperty.call(METALS, metal)) {\n      throw badRequest(`Geçersiz maden kodu",
    to: "if (false) {\n      throw badRequest(`Geçersiz maden kodu",
    test: 'test/pr8Remediation.test.js',
  },
  {
    id: 'settlement-direction-unchecked',
    file: 'services/posService.js',
    from: '    assertSettlementDirection(expected, deposited);',
    to: '    void assertSettlementDirection;',
    test: 'test/pr8Remediation.test.js',
  },
  {
    id: 'netted-settlement-posts-entry',
    file: 'services/posService.js',
    from: 'const netted = expected === 0n && deposited === 0n && difference === 0n;',
    to: 'const netted = false;',
    test: 'test/pr8Remediation.test.js',
  },
  {
    id: 'negative-settlement-deposit-unbounded',
    file: 'services/posService.js',
    from: "field: 'Yatan tutar', allowZero: true, allowNegative: true, min: -LIMITS.MAX_MONEY_MINOR,",
    to: "field: 'Yatan tutar', allowZero: true, allowNegative: true,",
    test: 'test/pr8Remediation.test.js',
  },
  {
    id: 'low-stock-threshold-ignored',
    file: 'routes/reports.js',
    from: 'stock: { $lte: threshold }',
    to: 'stock: { $lte: 5 }',
    test: 'test/pr8Remediation.test.js',
  },
];

function run(test) {
  const res = spawnSync(process.execPath, ['scripts/runTests.js', test], { cwd: root, encoding: 'utf8', env: { ...process.env, REQUEST_LOG: 'off' } });
  return res.status === 0;
}

function main() {
  const only = process.argv[2];
  const results = [];
  for (const m of MUTANTS.filter((x) => !only || x.id === only)) {
    const file = path.join(root, m.file);
    const original = fs.readFileSync(file, 'utf8');
    // Mutants are written with LF; the working copy may use CRLF.
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const from = m.from.replace(/\n/g, eol);
    const to = m.to.replace(/\n/g, eol);
    if (!original.includes(from)) {
      results.push({ id: m.id, result: 'NOT_APPLICABLE (source changed)' });
      console.log(`NOT_APPLICABLE ${m.id}`);
      continue;
    }
    fs.writeFileSync(file, original.replace(from, to));
    try {
      const passed = run(m.test);
      results.push({ id: m.id, test: m.test, result: passed ? 'SURVIVED' : 'killed' });
    } finally {
      fs.writeFileSync(file, original);
    }
    console.log(`${results.at(-1).result.padEnd(9)} ${m.id}`);
  }
  const survived = results.filter((r) => r.result !== 'killed');
  console.log(JSON.stringify({ mutants: results.length, killed: results.length - survived.length, survived }, null, 2));
  return survived.length ? 1 : 0;
}

process.exitCode = main();
