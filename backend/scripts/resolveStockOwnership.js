#!/usr/bin/env node
/**
 * Stock ownership recovery (see services/finance/stockOwnership.js and
 * backend/OPERATIONS.md → "Stock ownership recovery").
 *
 *   node scripts/resolveStockOwnership.js [--business=ID] [--resolutions=FILE]
 *       DRY RUN (default): JSON report of every product whose stock has no
 *       owning branch, is booked to a foreign branch, or lacks an opening;
 *       with the evidence used. Writes nothing.
 *
 *   node scripts/resolveStockOwnership.js --apply --confirm-backup [--business=ID] [--resolutions=FILE]
 *       Applies, one product per transaction: openings in the owning branch,
 *       branch assignment, and reclassification of quantity/cost booked to
 *       foreign branches (paired 'ownership_reclass' movements + balanced
 *       Dr inventory:{owner} / Cr inventory:{foreign} entries). Ambiguous
 *       products WITHOUT an explicit resolution are skipped and stay frozen.
 *       Afterwards every touched business is reconciled.
 *
 * FILE: JSON object { "<businessId>": { "<productId>": "<branch>" } } —
 * explicit owner decisions for ambiguous products (active branches only).
 *
 * Exit codes: 0 nothing left · 2 operator decisions still needed ·
 *             3 verification failed · 1 error.
 */
require('dotenv').config();
const fs = require('node:fs');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const stockOwnership = require('../services/finance/stockOwnership');
const ledger = require('../services/finance/ledgerService');
const inventory = require('../services/finance/inventoryService');
const { redactConnectionString } = require('../config/databaseCapabilities');

function readResolutions(path) {
  if (!path) return {};
  const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Resolutions file must be a JSON object keyed by businessId');
  return parsed;
}

async function run({ apply = false, business, resolutions = {} } = {}) {
  const businesses = business ? [business] : (await Product.collection.distinct('businessId')).filter(Boolean);
  const before = [];
  for (const biz of businesses) {
    const plan = await stockOwnership.planStockOwnership({ businessId: biz, resolutions: resolutions[biz] || {} });
    before.push(...plan.businesses);
  }
  if (!apply) return { mode: 'dry-run', businesses: before };

  const applied = [];
  const skipped = [];
  for (const summary of before) {
    const known = summary.knownBranches;
    for (const a of summary.products) {
      if (!a.actions?.length) {
        skipped.push({ businessId: summary.businessId, productId: a.productId, status: a.status });
        continue;
      }
      const explicit = (resolutions[summary.businessId] || {})[String(a.productId)];
      const done = await stockOwnership.applyProduct(summary.businessId, a.productId, { mode: 'operator', explicit, known });
      if (done) applied.push({ businessId: summary.businessId, productId: a.productId, owner: done.owner, basis: done.basis, actions: done.actions, foreign: done.foreign });
    }
  }
  const verification = [];
  for (const summary of before) {
    const [books, stock] = await Promise.all([ledger.reconcile(summary.businessId), inventory.reconcile(summary.businessId)]);
    verification.push({ businessId: summary.businessId, ok: books.ok && stock.ok, discrepancies: [...books.discrepancies, ...stock.discrepancies].slice(0, 50) });
  }
  const after = [];
  for (const summary of before) {
    const plan = await stockOwnership.planStockOwnership({ businessId: summary.businessId, resolutions: resolutions[summary.businessId] || {} });
    after.push(...plan.businesses);
  }
  return { mode: 'apply', applied, skipped, verification, after };
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  const business = (argv.find((a) => a.startsWith('--business=')) || '').split('=')[1] || undefined;
  const file = (argv.find((a) => a.startsWith('--resolutions=')) || '').slice('--resolutions='.length) || undefined;
  if (apply && !argv.includes('--confirm-backup')) {
    throw new Error('--apply requires --confirm-backup (take a mongodump first: backend/OPERATIONS.md)');
  }
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  // Dry run is strictly read-only (no automatic index builds on connect).
  if (!apply) {
    mongoose.set('autoIndex', false);
    mongoose.set('autoCreate', false);
  }
  await mongoose.connect(uri);
  try {
    // Ordering guard: before the financial migration, legacy products carry
    // no businessId and would be invisible here — "nothing left" would be a
    // false all-clear. The migration must run first (OPERATIONS.md).
    const untenanted = await Product.collection.countDocuments({ $or: [{ businessId: { $exists: false } }, { businessId: null }, { businessId: '' }] });
    if (untenanted > 0) {
      throw new Error(`${untenanted} ürün henüz işletmeye atanmamış: önce node scripts/migrate.js --apply --confirm-backup çalıştırılmalı`);
    }
    const result = await run({ apply, business, resolutions: readResolutions(file) });
    console.log(JSON.stringify(result, null, 2));
    const remaining = (result.after || result.businesses).some((b) => b.products.length || b.invalidResolutions.length);
    if (result.verification && result.verification.some((v) => !v.ok)) return 3;
    return remaining ? 2 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error('[resolveStockOwnership] failed:', redactConnectionString(error?.message, process.env.MONGO_URI));
    process.exitCode = 1;
  });
}

module.exports = { run, main };
