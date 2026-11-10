const User = require('../models/User');

const { DEFAULT_BUSINESS_ID, DEFAULT_BRANCH } = require('../config/tenancy');

/**
 * Idempotent startup migration for accounts created before business/branch
 * scoping existed. Mongoose fills defaults when *reading* a document, but
 * scoped queries (e.g. { businessId }) only match values stored in MongoDB.
 *
 * Also removes the never-released embedded `refreshTokens` array; sessions
 * now live in the AuthSession collection.
 */
async function migrateAuthData() {
  const collection = User.collection;
  const [business, branch, legacyTokens] = await Promise.all([
    collection.updateMany(
      { $or: [{ businessId: { $exists: false } }, { businessId: null }, { businessId: '' }] },
      { $set: { businessId: DEFAULT_BUSINESS_ID } },
    ),
    collection.updateMany(
      { $or: [{ branch: { $exists: false } }, { branch: null }, { branch: '' }] },
      { $set: { branch: DEFAULT_BRANCH } },
    ),
    collection.updateMany(
      { refreshTokens: { $exists: true } },
      { $unset: { refreshTokens: '' } },
    ),
  ]);

  const changed = business.modifiedCount + branch.modifiedCount + legacyTokens.modifiedCount;
  if (changed > 0) {
    console.log(`[migrate] Kullanıcı verisi güncellendi: businessId=${business.modifiedCount}, branch=${branch.modifiedCount}, eski refreshTokens=${legacyTokens.modifiedCount}`);
  }
  return {
    businessId: business.modifiedCount,
    branch: branch.modifiedCount,
    legacyRefreshTokens: legacyTokens.modifiedCount,
  };
}

module.exports = migrateAuthData;
module.exports.DEFAULT_BUSINESS_ID = DEFAULT_BUSINESS_ID;
module.exports.DEFAULT_BRANCH = DEFAULT_BRANCH;
