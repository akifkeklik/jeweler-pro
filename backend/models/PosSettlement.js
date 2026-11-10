const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

/**
 * Bank settlement (POS hesap kesimi / valör yatışı): a deposit by the
 * provider matched to open POS transactions.
 *   expected  = Σ allocations (net amounts the bank owed; refunds negative)
 *   deposited = the bank movement, signed: what arrived on the bank account
 *               (> 0), what the bank debited for a refund-only batch (< 0),
 *               or 0 for a batch whose captures and refunds net out; its
 *               sign always equals the sign of `expected` (posService)
 *   difference = deposited − expected, booked only with an explicit
 *                resolution (commission correction or settlement difference)
 * A netted batch (expected = deposited = 0) has no journal entry.
 * A settlement can be reversed (wrong match); it is never edited.
 */
const int = { type: Number, validate: Number.isSafeInteger };

const posSettlementSchema = new mongoose.Schema({
  businessId: { type: String, required: true, trim: true, index: true, immutable: true },
  branch: { type: String, required: true, trim: true, immutable: true },
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'PosProvider', default: null, immutable: true },
  settlementDate: { type: Date, required: true, immutable: true },
  bankReference: { type: String, trim: true, maxlength: 80, default: undefined, immutable: true },
  allocations: {
    type: [{
      _id: false,
      posTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PosTransaction', required: true },
      amountMinor: { ...int, required: true },
    }],
    immutable: true,
  },
  expectedMinor: { ...int, required: true, immutable: true },
  depositedMinor: { ...int, required: true, immutable: true },
  differenceMinor: { ...int, default: 0, immutable: true },
  differenceResolution: { type: String, enum: ['commission', 'settlement_difference', null], default: null, immutable: true },
  status: { type: String, enum: ['posted', 'reversed'], default: 'posted' },
  journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: null },
  reversalJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: null },
  reversedAt: { type: Date, default: null },
  reversalReason: { type: String, trim: true, maxlength: 300, default: undefined },
  notes: { type: String, trim: true, maxlength: 500, default: undefined },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
}, { timestamps: true, optimisticConcurrency: true });

posSettlementSchema.index({ businessId: 1, providerId: 1, settlementDate: -1 });

posSettlementSchema.plugin(tenantGuard);

module.exports = mongoose.model('PosSettlement', posSettlementSchema);
