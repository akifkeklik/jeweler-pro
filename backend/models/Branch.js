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
 * Legacy data may already contain two codes that only differ in case (both
 * referenced by the books), so the keys are not unique in general. `claims`
 * holds the keys a branch has reserved since the registry exists: the code
 * key of a branch created through it and its current display-name key. A
 * unique multikey index makes every reservation atomic, so concurrent
 * creations and renames can never leave two branches answering to one name.
 */
const branchSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // `${businessId}|${code}`
  businessId: { type: String, required: true, trim: true, immutable: true },
  code: { type: String, required: true, immutable: true },
  codeKey: { type: String, required: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  nameKey: { type: String, required: true },
  // Reserved keys (unique across the business). Absent on backfilled legacy
  // entries until they are renamed.
  claims: { type: [String], default: undefined },
  createdAt: { type: Date, default: Date.now, immutable: true },
  updatedAt: { type: Date, default: Date.now },
}, { versionKey: false, collection: 'branches', strict: 'throw' });

branchSchema.index({ businessId: 1, codeKey: 1 });
branchSchema.index(
  { businessId: 1, claims: 1 },
  { unique: true, partialFilterExpression: { claims: { $exists: true } }, name: 'reserved_keys' },
);
branchSchema.index({ businessId: 1, nameKey: 1 });
branchSchema.statics.idFor = (businessId, code) => `${businessId}|${code}`;

branchSchema.plugin(tenantGuard, { compositeId: true });

module.exports = mongoose.model('Branch', branchSchema);
