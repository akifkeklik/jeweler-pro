/**
 * Branches of a business.
 *
 * The application has no separate branch master data: a branch exists when
 * at least one ACTIVE user of the business is assigned to it (User.branch).
 * That is also the operational requirement for a transfer destination —
 * somebody must be able to receive the goods there.
 */
const User = require('../../models/User');
const { badRequest } = require('./core');

async function listBranches(businessId) {
  const branches = await User.distinct('branch', { businessId, active: true });
  return branches.filter((b) => typeof b === 'string' && b.trim()).sort((a, b) => a.localeCompare(b, 'tr'));
}

/** Throws 400 UNKNOWN_BRANCH unless `branch` is an active branch of the business. */
async function assertBranch(businessId, branch, label = 'Şube') {
  const name = typeof branch === 'string' ? branch.trim() : '';
  if (!name) throw badRequest(`${label} seçilmelidir`, 'BRANCH_REQUIRED');
  const exists = await User.exists({ businessId, branch: name, active: true });
  if (!exists) throw badRequest(`${label} bu işletmenin aktif bir şubesi değil: ${name}`, 'UNKNOWN_BRANCH');
  return name;
}

module.exports = { listBranches, assertBranch };
