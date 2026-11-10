const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

/**
 * Card payment provider / bank POS agreement of a business (e.g. one bank's
 * virtual or physical POS). Commission rules are per installment count.
 *
 * Rules are VERSIONED: a change creates a new version and the previous one
 * is kept in `history`. Card transactions store a snapshot of the rule they
 * were charged with, so history is never recalculated with today's rates.
 */
const int = { type: Number, validate: Number.isSafeInteger };

const ruleSchema = new mongoose.Schema({
  installments: { ...int, required: true, min: 1, max: 36 },
  ratePpm: { ...int, required: true, min: 0, max: 999999 },   // parts per million of gross
  fixedFeeMinor: { ...int, default: 0, min: 0 },              // kuruş per transaction
  valorDays: { ...int, default: 1, min: 0, max: 400 },        // days until the bank pays out
}, { _id: false });

const historySchema = new mongoose.Schema({
  version: { ...int, required: true },
  rules: { type: [ruleSchema], default: [] },
  refundCommissionPolicy: { type: String, enum: ['retained', 'reversed'] },
  validFrom: { type: Date, required: true },
  validTo: { type: Date, required: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false });

const posProviderSchema = new mongoose.Schema({
  businessId: { type: String, required: true, trim: true, index: true, immutable: true },
  code: { type: String, required: true, trim: true, maxlength: 40, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  // Empty = available in every branch.
  branches: { type: [String], default: [] },
  active: { type: Boolean, default: true },
  // What happens to the commission when a card payment is refunded:
  //   retained  the bank keeps it (commission stays an expense)
  //   reversed  the bank refunds it proportionally
  refundCommissionPolicy: { type: String, enum: ['retained', 'reversed'], default: 'retained' },
  rules: { type: [ruleSchema], default: [] },
  version: { ...int, default: 1, min: 1 },
  validFrom: { type: Date, default: Date.now },
  history: { type: [historySchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, optimisticConcurrency: true });

posProviderSchema.index({ businessId: 1, code: 1 }, { unique: true });

posProviderSchema.plugin(tenantGuard);

module.exports = mongoose.model('PosProvider', posProviderSchema);
