#!/usr/bin/env node
/**
 * Financial data migration CLI.
 *
 *   node scripts/migrate.js                 dry run (default): JSON plan, writes nothing
 *   node scripts/migrate.js --business=ID   dry run limited to one business
 *   node scripts/migrate.js --apply --confirm-backup
 *                                           applies the migration, then re-plans and
 *                                           reconciles every business (verification)
 *
 * Exit codes: 0 ok · 2 dry run found pending work or blocking duplicates · 3 verification failed
 *             · 1 error (incl. apply refused: blocking duplicates — nothing was written).
 * Take a backup first (see backend/OPERATIONS.md → "Backup & restore"); --apply
 * refuses to run without --confirm-backup.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { planFinancialMigration } = require('./migrationPlan');
const migrateFinancialData = require('./migrateFinancialData');
const ledger = require('../services/finance/ledgerService');
const inventory = require('../services/finance/inventoryService');
const transferService = require('../services/transferService');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const { redactConnectionString } = require('../config/databaseCapabilities');

async function verify() {
  const businesses = [...new Set([
    // Operator verification spans every tenant by design.
    ...(await Product.distinct('businessId').setOptions({ skipTenantGuard: 'operator-migration' })),
    ...(await Customer.distinct('businessId').setOptions({ skipTenantGuard: 'operator-migration' })),
  ])].filter(Boolean);
  const results = [];
  for (const businessId of businesses) {
    const [books, stock, transfers] = await Promise.all([ledger.reconcile(businessId), inventory.reconcile(businessId), transferService.reconcile(businessId)]);
    results.push({
      businessId,
      ok: books.ok && stock.ok && transfers.ok,
      discrepancies: [...books.discrepancies, ...stock.discrepancies, ...transfers.discrepancies].slice(0, 50),
    });
  }
  return results;
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  const business = (argv.find((a) => a.startsWith('--business=')) || '').split('=')[1] || undefined;
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  // Refuse unsafe invocations BEFORE connecting: nothing may touch the database.
  if (apply && business) throw new Error('--apply always migrates the whole database; omit --business');
  if (apply && !argv.includes('--confirm-backup')) {
    throw new Error('--apply requires --confirm-backup (take a mongodump first: backend/OPERATIONS.md)');
  }
  // Never build indexes implicitly on connect (Mongoose's default): a dry run
  // must be strictly read-only, and a blocked apply must write nothing. The
  // apply builds the indexes explicitly (migrateFinancialData → migrateIndexes)
  // after its pre-flight checks.
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  await mongoose.connect(uri);
  try {
    const before = await planFinancialMigration({ businessId: business });
    if (!apply) {
      console.log(JSON.stringify({ mode: 'dry-run', plan: before }, null, 2));
      return before.pending || before.blocking ? 2 : 0;
    }
    const report = await migrateFinancialData();
    const after = await planFinancialMigration();
    const reconciliation = await verify();
    const ok = !after.pending && reconciliation.every((r) => r.ok);
    console.log(JSON.stringify({
      mode: 'apply', before, report, after: { pending: after.pending, issues: after.issues }, reconciliation, ok,
    }, null, 2));
    return ok ? 0 : 3;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error('[migrate] failed:', redactConnectionString(error?.message, process.env.MONGO_URI));
    process.exitCode = 1;
  });
}

module.exports = { main, verify };
