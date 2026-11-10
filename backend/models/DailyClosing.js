const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

/**
 * Z-report / daily cash closing — one per business, branch and local
 * calendar day. Once closed it is locked: no second closing, and no further
 * cash postings for that branch on that day (enforced by the ledger).
 * Calculated figures come from the ledger cash account; a counted cash
 * difference is posted as a journal entry (kasa farkı).
 */
const dailyClosingSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, trim: true, index: true, immutable: true },
    branch: { type: String, trim: true, default: '' },
    // 'YYYY-MM-DD' in REPORT_TIME_ZONE; indexed by the tenant-scoped unique index below.
    date: { type: String, required: true },
    openingCashTry: { type: Number, default: 0 },
    openingGoldGrams: { type: Number, default: 0 },
    totalSalesTry: { type: Number, default: 0 },
    totalSalesCount: { type: Number, default: 0 },
    totalCollectionsTry: { type: Number, default: 0 },
    totalPaymentsTry: { type: Number, default: 0 },
    closingCashCalculated: { type: Number, default: 0 },
    closingCashActual: { type: Number, default: 0 },
    cashDifference: { type: Number, default: 0 },
    closingGoldCalculated: { type: Number, default: 0 },
    closingGoldActual: { type: Number, default: 0 },
    goldDifference: { type: Number, default: 0 },
    closingCashCalculatedMinor: { type: Number, default: undefined, validate: (v) => v === undefined || Number.isSafeInteger(v) },
    closingCashActualMinor: { type: Number, default: undefined, validate: (v) => v === undefined || Number.isSafeInteger(v) },
    differenceJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: undefined },
    // Gold counted at closing → its difference is posted (gold_over_short) and the gold till locked.
    goldCounted: { type: Boolean, default: false },
    goldDifferenceJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: undefined },
    isClosed: { type: Boolean, default: false, index: true },
    closedAt: { type: Date },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

dailyClosingSchema.index({ businessId: 1, branch: 1, date: 1 }, { unique: true });

dailyClosingSchema.plugin(tenantGuard);

module.exports = mongoose.model('DailyClosing', dailyClosingSchema);
