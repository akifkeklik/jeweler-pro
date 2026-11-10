const mongoose = require('mongoose');

/**
 * Minimal tombstone of a permanently deleted user.
 *
 * Audit records reference their actor only by id. Without this tombstone the
 * tenant of a deleted actor can no longer be determined, so the actor's audit
 * history would disappear from the business' audit view.
 *
 * Data minimisation: no name, e-mail, password or session material is kept —
 * only what is needed to attribute audit records to the right tenant.
 */
const deletedUserSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, required: true },
  businessId: { type: String, required: true, trim: true, index: true, immutable: true },
  role: { type: String, trim: true, default: '', immutable: true },
  deletedAt: { type: Date, required: true, default: Date.now, immutable: true },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { versionKey: false, collection: 'deleted_users', strict: 'throw' });

module.exports = mongoose.model('DeletedUser', deletedUserSchema);
