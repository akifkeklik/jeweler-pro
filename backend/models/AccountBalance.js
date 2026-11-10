const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

/**
 * Running balance of one ledger account in one unit — a projection of the
 * immutable journal, updated in the SAME transaction as every posting.
 * balance = debit − credit (debit-normal). The journal is authoritative;
 * ledger reconciliation recomputes these documents from it.
 *
 * `closedDate` (cash accounts): the local calendar day whose Z-report is
 * locked. Postings to a cash account update this very document with the
 * guard { closedDate ≠ today }, and the daily closing writes it too, so a
 * closing and a concurrent cash posting always conflict and serialise.
 */
const accountBalanceSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // `${businessId}|${account}|${unit}`
  businessId: { type: String, required: true, trim: true, index: true, immutable: true },
  account: { type: String, required: true, trim: true, immutable: true },
  unit: { type: String, required: true, enum: ['TRY', 'XAU', 'XAG'], immutable: true },
  debit: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  credit: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  closedDate: { type: String, default: null },
  lastPostedAt: { type: Date, default: null },
}, { versionKey: false, collection: 'account_balances', strict: 'throw' });

accountBalanceSchema.index({ businessId: 1, account: 1 });

accountBalanceSchema.statics.idFor = (businessId, account, unit) => `${businessId}|${account}|${unit}`;

accountBalanceSchema.plugin(tenantGuard, { compositeId: true });

module.exports = mongoose.model('AccountBalance', accountBalanceSchema);
