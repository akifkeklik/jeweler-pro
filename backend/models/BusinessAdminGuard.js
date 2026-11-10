const mongoose = require('mongoose');

/**
 * One coordination document per business (tenant).
 *
 * MongoDB transactions use snapshot isolation, which permits write skew: two
 * concurrent transactions can each count "one other active admin", then each
 * deactivate a different admin and both commit, leaving zero admins.
 *
 * Every user-management mutation that can lower the number of active admins
 * first writes this document inside its transaction. Two such transactions
 * therefore always write the same document; MongoDB aborts one with a
 * WriteConflict (TransientTransactionError) and the driver retries it on a
 * fresh snapshot that already contains the other transaction's commit.
 */
const businessAdminGuardSchema = new mongoose.Schema({
  _id: { type: String, required: true, trim: true },
  seq: { type: Number, default: 0, min: 0 },
  lastMutationAt: { type: Date, default: null },
}, { versionKey: false, collection: 'business_admin_guards' });

module.exports = mongoose.model('BusinessAdminGuard', businessAdminGuardSchema);
