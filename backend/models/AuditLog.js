const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  action: { type: String, required: true, immutable: true, trim: true },
  resourceType: { type: String, required: true, immutable: true, trim: true },
  resourceId: { type: String, required: true, immutable: true, trim: true },
  correlationId: { type: String, required: true, immutable: true, trim: true },
  before: { type: mongoose.Schema.Types.Mixed, default: undefined, immutable: true },
  after: { type: mongoose.Schema.Types.Mixed, default: undefined, immutable: true },
  // Retention (see backend/SECURITY.md → "Audit data retention"): set only on
  // new high-volume security-telemetry records. Records without it — every
  // business/state-change record and all historical records — never expire.
  expiresAt: { type: Date, default: undefined, immutable: true },
}, {
  timestamps: { createdAt: true, updatedAt: false },
  strict: 'throw',
});

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorUserId: 1, createdAt: -1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
// TTL: MongoDB deletes a record once its own expiresAt has passed. Documents
// without expiresAt are ignored by TTL indexes, so history is never rewritten.
auditLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
