/**
 * Branches of a business.
 *
 * A branch is OPERATIONAL when at least one active user of the business is
 * assigned to it (User.branch): somebody must be able to receive goods or
 * run the till there. That rule is unchanged.
 *
 * Identity (ADR 0001, phase 1): every branch also has a registry entry
 * (models/Branch.js) with an immutable `code` (the value stored on users,
 * sales, stock and ledger account codes) and an editable display `name`.
 * The registry is filled lazily from the users' branches, so existing data
 * needs no migration. Renaming changes only the display name; matching is
 * case- and whitespace-insensitive, so near-duplicates resolve to the
 * existing branch instead of creating a new one.
 */
const User = require('../../models/User');
const Branch = require('../../models/Branch');
const { badRequest, conflict, notFound } = require('./core');

const MAX_NAME_LENGTH = 120;
// Separators of ledger account codes (`cash:{branch}`) and composite ids (`a|b|c`).
const RESERVED_CHARACTERS = /[:|]/;

/** Trims, collapses inner whitespace and applies Unicode NFC. */
function normalizeBranchName(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Case- and whitespace-insensitive comparison key (Turkish casing). */
function branchKey(value) {
  return normalizeBranchName(value).toLocaleLowerCase('tr-TR');
}

function validName(raw, label = 'Şube adı') {
  const name = normalizeBranchName(raw);
  if (!name) throw badRequest(`${label} boş olamaz`, 'BRANCH_REQUIRED');
  if (name.length > MAX_NAME_LENGTH) throw badRequest(`${label} en fazla ${MAX_NAME_LENGTH} karakter olabilir`, 'BRANCH_NAME_TOO_LONG');
  return name;
}

const registryEntry = (businessId, code) => ({
  _id: Branch.idFor(businessId, code),
  businessId,
  code,
  codeKey: branchKey(code),
  name: code,
  nameKey: branchKey(code),
});

/** Registers every branch that users are assigned to (idempotent; never renames). */
async function syncRegistry(businessId) {
  const codes = (await User.distinct('branch', { businessId }))
    .filter((b) => typeof b === 'string' && b.trim());
  if (!codes.length) return;
  await Branch.bulkWrite(codes.map((code) => {
    const entry = registryEntry(businessId, code);
    return { updateOne: { filter: { _id: entry._id, businessId }, update: { $setOnInsert: entry }, upsert: true } };
  }), { ordered: false });
}

async function listBranches(businessId) {
  const branches = await User.distinct('branch', { businessId, active: true });
  return branches.filter((b) => typeof b === 'string' && b.trim()).sort((a, b) => a.localeCompare(b, 'tr'));
}

/** Operational branches with their display names: [{ code, name }], sorted by name. */
async function listBranchRecords(businessId) {
  await syncRegistry(businessId);
  const [codes, entries] = await Promise.all([
    listBranches(businessId),
    Branch.find({ businessId }).select('code name').lean(),
  ]);
  const nameOf = new Map(entries.map((e) => [e.code, e.name]));
  return codes
    .map((code) => ({ code, name: nameOf.get(code) || code }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** Throws 400 UNKNOWN_BRANCH unless `branch` is an active branch of the business. */
async function assertBranch(businessId, branch, label = 'Şube') {
  const name = typeof branch === 'string' ? branch.trim() : '';
  if (!name) throw badRequest(`${label} seçilmelidir`, 'BRANCH_REQUIRED');
  const exists = await User.exists({ businessId, branch: name, active: true });
  if (!exists) throw badRequest(`${label} bu işletmenin aktif bir şubesi değil: ${name}`, 'UNKNOWN_BRANCH');
  return name;
}

/**
 * The branch code to store when a user is assigned to `raw`:
 *   - an exact code is kept as is;
 *   - otherwise a case/whitespace variant of an existing code or display name
 *     resolves to that branch's code;
 *   - otherwise a new branch is registered (no ":" or "|" allowed in codes).
 */
async function resolveBranchCode(businessId, raw) {
  const name = validName(raw);
  await syncRegistry(businessId);
  const exact = await Branch.findOne({ _id: Branch.idFor(businessId, name), businessId }).lean();
  if (exact) return exact.code;
  const key = branchKey(name);
  const matches = await Branch.find({ businessId, $or: [{ codeKey: key }, { nameKey: key }] }).sort({ createdAt: 1 }).lean();
  if (matches.length) return matches[0].code;
  if (RESERVED_CHARACTERS.test(name)) {
    throw badRequest('Şube adında ":" veya "|" kullanılamaz', 'INVALID_BRANCH_NAME');
  }
  const entry = registryEntry(businessId, name);
  await Branch.updateOne({ _id: entry._id, businessId }, { $setOnInsert: entry }, { upsert: true });
  return name;
}

/** Changes a branch's display name only; the code (and so all history) stays. */
async function renameBranch(businessId, code, rawName) {
  const name = validName(rawName);
  await syncRegistry(businessId);
  const branch = await Branch.findOne({ _id: Branch.idFor(businessId, String(code)), businessId });
  if (!branch) throw notFound('Şube bulunamadı', 'BRANCH_NOT_FOUND');
  const key = branchKey(name);
  const clash = await Branch.exists({
    businessId, _id: { $ne: branch._id }, $or: [{ codeKey: key }, { nameKey: key }],
  });
  if (clash) throw conflict('Bu ad başka bir şube tarafından kullanılıyor', 'BRANCH_NAME_IN_USE');
  const before = { name: branch.name };
  branch.name = name;
  branch.nameKey = key;
  branch.updatedAt = new Date();
  await branch.save();
  return { branch: { code: branch.code, name: branch.name }, before };
}

module.exports = {
  listBranches,
  listBranchRecords,
  assertBranch,
  resolveBranchCode,
  renameBranch,
  syncRegistry,
  normalizeBranchName,
  branchKey,
};
