const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

/**
 * POS sub-ledger: one card capture (payment) or card refund.
 *
 * Signed amounts (kuruş):
 *   payment  grossMinor > 0, commissionMinor ≥ 0, netMinor = gross − commission > 0
 *   refund   grossMinor < 0, commissionMinor ≤ 0 (reversed commission, if the
 *            provider refunds it), netMinor = gross − commission < 0
 * netMinor is what the bank owes (payment) or deducts (refund) at settlement.
 * settledMinor has the sign of netMinor; open = netMinor − settledMinor.
 *
 * The commission rule is SNAPSHOTTED at capture — a later rate change never
 * alters a recorded transaction. A successful POS authorisation is NOT a
 * settlement: the item stays open until a bank deposit is matched to it.
 */
const int = { type: Number, validate: Number.isSafeInteger };
const nullableInt = { type: Number, validate: (v) => v === null || v === undefined || Number.isSafeInteger(v) };

const posTransactionSchema = new mongoose.Schema({
  businessId: { type: String, required: true, trim: true, index: true, immutable: true },
  branch: { type: String, required: true, trim: true, immutable: true },
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'PosProvider', default: null, immutable: true },
  providerCode: { type: String, trim: true, default: null, immutable: true },
  kind: { type: String, enum: ['payment', 'refund'], required: true, immutable: true },
  source: { type: String, trim: true, maxlength: 40, immutable: true },
  reference: {
    kind: { type: String, trim: true },
    id: { type: String, trim: true },
  },
  installments: { ...int, default: 1, min: 1, max: 36, immutable: true },
  commissionSnapshot: {
    configured: { type: Boolean, default: false },
    ruleVersion: { ...nullableInt, default: null },
    ratePpm: { ...int, default: 0 },
    fixedFeeMinor: { ...int, default: 0 },
    valorDays: { ...nullableInt, default: null },
    refundCommissionPolicy: { type: String, default: null },
  },
  grossMinor: { ...int, required: true, immutable: true },
  commissionMinor: { ...int, required: true, immutable: true },
  netMinor: { ...int, required: true, immutable: true },
  settledMinor: { ...int, default: 0 },
  // payments only: gross already refunded (for proportional commission reversal)
  refundedGrossMinor: { ...int, default: 0, min: 0 },
  status: { type: String, enum: ['open', 'partially_settled', 'settled'], default: 'open', index: true },
  capturedAt: { type: Date, default: Date.now, immutable: true },
  expectedSettlementDate: { type: Date, default: null },
  originalTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PosTransaction', default: null, immutable: true },
  terminalId: { type: String, trim: true, maxlength: 40, default: undefined },
  authCode: { type: String, trim: true, maxlength: 40, default: undefined },
  paymentJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: null },
  commissionJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
  correlationId: { type: String, trim: true, default: undefined, immutable: true },
}, { timestamps: true, versionKey: false });

posTransactionSchema.index({ businessId: 1, providerId: 1, branch: 1, status: 1, expectedSettlementDate: 1 });
posTransactionSchema.index({ businessId: 1, 'reference.kind': 1, 'reference.id': 1 });

posTransactionSchema.plugin(tenantGuard);

module.exports = mongoose.model('PosTransaction', posTransactionSchema);
