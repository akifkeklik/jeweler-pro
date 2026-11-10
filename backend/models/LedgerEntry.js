const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

/**
 * Immutable double-entry journal (yevmiye kaydı).
 *
 * Every financial event (sale, collection, payment, purchase, return,
 * reversal, cash-count difference, opening balance) is one entry with ≥ 2
 * lines. Amounts are positive integers in the line's unit:
 *   TRY  kuruş
 *   XAU  milligrams of fine gold (customer gold accounts, gold till)
 *   XAG  milligrams of fine silver
 * For EACH unit, Σ debit == Σ credit — enforced here, so no code path can
 * persist an unbalanced entry.
 *
 * Entries are never updated or deleted. A correction is a new entry with
 * `reversalOf` pointing at the original (and the original gets `reversedBy`
 * set exactly once).
 */
const UNITS = ['TRY', 'XAU', 'XAG'];
const ENTRY_TYPES = [
  'sale', 'sale_payment', 'sale_cancel', 'sale_return', 'sale_refund',
  'collection', 'customer_payment', 'customer_opening',
  'cash_opening', 'expense', 'cash_count_difference', 'gold_count_difference',
  'purchase', 'purchase_cancel', 'supplier_payment', 'supplier_opening',
  'scrap_purchase', 'gold_collection', 'gold_payment',
  'inventory_opening', 'inventory_adjustment', 'inventory_revaluation',
  'opening_migration',
  'transfer_dispatch', 'transfer_receipt', 'transfer_return', 'transfer_loss',
  'purchase_return', 'purchase_price_adjustment', 'supplier_refund',
  'pos_commission', 'pos_commission_reversal', 'pos_settlement', 'pos_settlement_reversal',
  'inventory_ownership_reclass',
];

const lineSchema = new mongoose.Schema({
  account: { type: String, required: true, trim: true, maxlength: 120 },
  unit: { type: String, required: true, enum: UNITS },
  debit: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  credit: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  customerId: { type: Number, default: undefined },
  supplierId: { type: Number, default: undefined },
  memo: { type: String, trim: true, maxlength: 200, default: undefined },
}, { _id: false });

const ledgerEntrySchema = new mongoose.Schema({
  businessId: { type: String, required: true, trim: true, index: true, immutable: true },
  branch: { type: String, required: true, trim: true, immutable: true },
  entryType: { type: String, required: true, enum: ENTRY_TYPES, immutable: true },
  date: { type: Date, required: true, default: Date.now, immutable: true },
  description: { type: String, trim: true, maxlength: 300, immutable: true },
  reference: {
    kind: { type: String, trim: true },
    id: { type: String, trim: true },
  },
  lines: { type: [lineSchema], required: true, immutable: true },
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: null, immutable: true },
  reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: null },
  // One-time keys for migrations / system postings (unique when present).
  externalKey: { type: String, trim: true, default: undefined, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
  correlationId: { type: String, trim: true, default: undefined, immutable: true },
}, {
  timestamps: { createdAt: true, updatedAt: false },
  strict: 'throw',
  versionKey: false,
});

ledgerEntrySchema.index({ businessId: 1, 'lines.account': 1, date: 1 });
ledgerEntrySchema.index({ businessId: 1, branch: 1, date: 1 });
ledgerEntrySchema.index({ businessId: 1, 'reference.kind': 1, 'reference.id': 1 });
ledgerEntrySchema.index({ businessId: 1, externalKey: 1 }, { unique: true, partialFilterExpression: { externalKey: { $type: 'string' } } });

function unbalancedUnits(lines) {
  const totals = new Map();
  for (const line of lines) {
    const t = totals.get(line.unit) || { debit: 0, credit: 0 };
    t.debit += line.debit || 0;
    t.credit += line.credit || 0;
    totals.set(line.unit, t);
  }
  return [...totals.entries()].filter(([, t]) => t.debit !== t.credit).map(([unit]) => unit);
}

ledgerEntrySchema.pre('validate', function validateBalanced() {
  const lines = this.lines || [];
  if (lines.length < 2) {
    this.invalidate('lines', 'Bir muhasebe kaydı en az iki satır içermelidir');
    return;
  }
  for (const line of lines) {
    const debit = line.debit || 0;
    const credit = line.credit || 0;
    if ((debit > 0) === (credit > 0)) {
      this.invalidate('lines', 'Her satırda yalnızca borç veya yalnızca alacak tutarı (sıfırdan büyük) bulunmalıdır');
      return;
    }
  }
  const unbalanced = unbalancedUnits(lines);
  if (unbalanced.length) this.invalidate('lines', `Kayıt dengede değil (${unbalanced.join(', ')}): borç ≠ alacak`);
});

ledgerEntrySchema.plugin(tenantGuard);

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
module.exports.ENTRY_TYPES = ENTRY_TYPES;
module.exports.UNITS = UNITS;
module.exports.unbalancedUnits = unbalancedUnits;
