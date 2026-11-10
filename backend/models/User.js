const mongoose = require('mongoose');

const ROLES = Object.freeze(['admin', 'manager', 'staff']);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '', maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'staff', required: true, index: true },
    branch: { type: String, required: true, trim: true, maxlength: 120 },
    businessId: { type: String, required: true, trim: true, index: true },
    customPermissions: [{ type: String, trim: true }],
    active: { type: Boolean, default: true, index: true },
    tokenVersion: { type: Number, default: 0, min: 0 },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    // Only the SHA-256 hash of the single-use reset token is ever persisted.
    passwordResetTokenHash: { type: String, default: undefined, select: false, index: true },
    passwordResetExpires: { type: Date, default: undefined, select: false },
    passwordResetRequestedAt: { type: Date, default: undefined, select: false },
    // tokenVersion at issuance. A reset token is only consumable while the
    // account's tokenVersion is unchanged, so deactivation, password changes
    // and session revocation invalidate outstanding reset links for good.
    passwordResetTokenVersion: { type: Number, default: undefined, select: false },
  },
  { timestamps: true }
);

/**
 * Invalidates every access token (tokenVersion) and every refresh session of a user.
 */
userSchema.statics.revokeTokens = async function revokeTokens(userId, reason = 'revoke_all') {
  const user = await this.findByIdAndUpdate(
    userId,
    { $inc: { tokenVersion: 1 } },
    { new: true, runValidators: true }
  );
  // Lazy require avoids a circular model import at load time.
  const AuthSession = mongoose.models.AuthSession || require('./AuthSession');
  await AuthSession.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } }
  );
  return user;
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
