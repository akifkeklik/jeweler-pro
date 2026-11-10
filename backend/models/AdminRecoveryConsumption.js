const mongoose = require('mongoose');

/**
 * Record of a consumed break-glass admin recovery token (scripts/bootstrapAdmin.js).
 *
 * `_id` is the SHA-256 of ADMIN_RECOVERY_TOKEN — never the token itself. It is
 * written in the same transaction as the account change and its audit
 * record, so a token can be used exactly once: a leftover ADMIN_RECOVERY /
 * ADMIN_RECOVERY_TOKEN on later restarts (or a second API instance starting at
 * the same moment) finds this record and changes nothing.
 */
const adminRecoveryConsumptionSchema = new mongoose.Schema({
  _id: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
  businessId: { type: String, required: true, trim: true, immutable: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  outcome: { type: String, required: true, enum: ['recovered', 'recovered_created', 'already_active'], immutable: true },
  overrideActiveAdmins: { type: Boolean, default: false, immutable: true },
  consumedAt: { type: Date, required: true, default: Date.now, immutable: true },
}, { versionKey: false, collection: 'admin_recovery_consumptions', strict: 'throw' });

module.exports = mongoose.model('AdminRecoveryConsumption', adminRecoveryConsumptionSchema);
