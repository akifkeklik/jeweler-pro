const mongoose = require('mongoose');

/**
 * Idempotency of financial commands (Idempotency-Key request header).
 *
 * The record is inserted inside the SAME transaction as the operation it
 * protects, so either both exist or neither does. A retried request with the
 * same key and the same payload returns the original result; the same key
 * with a different payload is rejected. Records expire after 7 days.
 */
const idempotencyRecordSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // `${businessId}|${scope}|${key}`
  businessId: { type: String, required: true, trim: true, immutable: true },
  scope: { type: String, required: true, trim: true, immutable: true },
  requestHash: { type: String, required: true, immutable: true },
  resourceType: { type: String, required: true, immutable: true },
  resourceId: { type: String, required: true, immutable: true },
  statusCode: { type: Number, required: true, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { versionKey: false, collection: 'idempotency_records', strict: 'throw' });

idempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('IdempotencyRecord', idempotencyRecordSchema);
