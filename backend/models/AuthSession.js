const mongoose = require('mongoose');

/**
 * One document per login (device/browser session).
 * Only SHA-256 hashes of refresh tokens are stored. The refresh token rotates
 * on every use; recently used hashes are kept to detect token replay.
 */
const authSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  businessId: { type: String, trim: true, default: '' },
  tokenHash: { type: String, required: true, unique: true },
  previousTokenHashes: { type: [String], default: [], index: true },
  rotatedAt: { type: Date, default: null },
  persistent: { type: Boolean, default: false },
  tokenVersion: { type: Number, required: true, min: 0 },
  expiresAt: { type: Date, required: true },
  lastUsedAt: { type: Date, default: Date.now },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: null },
}, { timestamps: true });

authSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: 1 });
// MongoDB removes expired sessions automatically one day after expiry.
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = mongoose.model('AuthSession', authSessionSchema);
