const mongoose = require('mongoose');
const tenantGuard = require('./plugins/tenantGuard');

/**
 * Branch registry (ADR 0001, phase 1).
 *
 * `code` is the identifier stored everywhere else (User.branch, Sale.branch,
 * ledger account codes, MetalStock ids, …) and never changes, so a branch's
 * history can never split. `name` is the editable display name. `codeKey`
 * and `nameKey` are case- and whitespace-insensitive lookup keys used to
 * stop "Merkez" / "merkez " from becoming two branches.
 *
 * Not unique on the keys: legacy data may already contain two codes that only
 * differ in case, and both are referenced by the books. New branches and
 * renames are checked against both keys in branchDirectory.js.
 */
const branchSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // `${businessId}|${code}`
  businessId: { type: String, required: true, trim: true, immutable: true },
  code: { type: String, required: true, immutable: true },
  codeKey: { type: String, required: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  nameKey: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
  updatedAt: { type: Date, default: Date.now },
}, { versionKey: false, collection: 'branches', strict: 'throw' });

branchSchema.index({ businessId: 1, codeKey: 1 });
branchSchema.index({ businessId: 1, nameKey: 1 });
branchSchema.statics.idFor = (businessId, code) => `${businessId}|${code}`;

branchSchema.plugin(tenantGuard, { compositeId: true });

module.exports = mongoose.model('Branch', branchSchema);
