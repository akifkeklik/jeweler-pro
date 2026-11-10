const { getEffectivePermissions } = require('../middleware/authorization');

/**
 * The only shape in which a user leaves the API. Never includes password,
 * reset-token or session material.
 */
function toPublicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    email: user.email,
    name: user.name || user.email,
    role: user.role,
    branch: user.branch || '',
    businessId: user.businessId || '',
    customPermissions: [...(user.customPermissions || [])],
    permissions: getEffectivePermissions(user),
    active: user.active !== false,
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt || null,
  };
}

module.exports = { toPublicUser };
