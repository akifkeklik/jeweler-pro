/**
 * Branch registry (ADR 0001, phase 1) — real MongoDB replica set, real HTTP.
 * A branch keeps its stored code forever; only the display name changes, and
 * case / whitespace variants never create a second branch.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'branch-registry-tests-secret-with-more-than-thirty-two-chars';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:8080';

const uri = process.env.MONGO_URI;
const app = require('../server');
const User = require('../models/User');
const Branch = require('../models/Branch');
const AuditLog = require('../models/AuditLog');
const { signToken } = require('../middleware/auth');
const { hashPassword } = require('../utils/passwords');
const { normalizeBranchName, branchKey, resolveBranchCode } = require('../services/finance/branchDirectory');
const { createHarness, uid } = require('../testSupport/financeHarness');

const PASSWORD = 'Branch-Registry-Pass-2026';
const harness = createHarness({ app, signToken, User, hashPassword });

async function newUser(api, branch) {
  const email = `u_${uid()}@registry.test`;
  const res = await api.post('/api/users', { email, name: 'Şube Personeli', password: PASSWORD, role: 'staff', branch });
  return { ...res, email };
}

describe('Branch registry: stable codes, editable names', { skip: !uri && 'MONGO_URI not set — run `npm test`' }, () => {
  before(async () => {
    await mongoose.connect(uri);
    await Promise.all([User, Branch, AuditLog].map((M) => M.init()));
    await harness.start();
  });
  after(async () => {
    await harness.stop();
    await mongoose.disconnect();
  });

  it('normalises names: whitespace collapsed, Turkish-aware case key', () => {
    assert.equal(normalizeBranchName('  Merkez   Şube '), 'Merkez Şube');
    assert.equal(branchKey('MERKEZ İSTANBUL'), branchKey('merkez istanbul'));
    assert.notEqual(branchKey('Işık'), branchKey('isik'));
  });

  it('lists existing branches lazily (no migration) with their codes as names', async () => {
    const t = await harness.tenant({ branches: ['Merkez', 'Bağdat Caddesi'] });
    const res = await t.admin.get('/api/branches');
    assert.equal(res.status, 200);
    assert.equal(res.body.current, 'Merkez');
    assert.deepEqual(res.body.branches.map((b) => b.code).sort(), ['Bağdat Caddesi', 'Merkez']);
    assert.ok(res.body.branches.every((b) => b.name === b.code));
  });

  it('a case / whitespace variant resolves to the existing branch instead of creating a new one', async () => {
    const t = await harness.tenant({ branches: ['Merkez Şube'] });
    const created = await newUser(t.admin, '  MERKEZ   şube ');
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const stored = await User.findOne({ businessId: t.businessId, email: created.email }).lean();
    assert.equal(stored.branch, 'Merkez Şube');
    assert.equal(await Branch.countDocuments({ businessId: t.businessId }), 1);
  });

  it('a genuinely new branch is registered; reserved separators are refused', async () => {
    const t = await harness.tenant({ branches: ['Merkez'] });
    assert.equal((await newUser(t.admin, 'Nişantaşı')).status, 201);
    assert.ok(await Branch.exists({ businessId: t.businessId, code: 'Nişantaşı' }));
    const bad = await newUser(t.admin, 'Kasa:1');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'INVALID_BRANCH_NAME');
    assert.equal(await User.countDocuments({ businessId: t.businessId, branch: 'Kasa:1' }), 0);
  });

  it('concurrent variants of a new branch resolve to one code (no split under a race)', async () => {
    const t = await harness.tenant({ branches: ['Merkez'] });
    const variants = ['Yeni Şube', 'yeni şube ', 'YENİ   ŞUBE', 'Yeni şube', ' yeni Şube'];
    const codes = await Promise.all(variants.map((v) => resolveBranchCode(t.businessId, v)));
    assert.equal(new Set(codes).size, 1, `codes: ${codes.join(', ')}`);
    assert.equal(await Branch.countDocuments({ businessId: t.businessId, codeKey: branchKey('yeni şube') }), 1);
  });

  it('renaming changes only the display name: codes on users stay, the old and new names keep resolving', async () => {
    const t = await harness.tenant({ branches: ['Merkez', 'Kadıköy'] });
    const res = await t.admin.patch(`/api/branches/${encodeURIComponent('Merkez')}`, { name: 'Kapalıçarşı Merkez' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { code: 'Merkez', name: 'Kapalıçarşı Merkez' });
    assert.equal(await User.countDocuments({ businessId: t.businessId, branch: 'Merkez' }), 4, 'no user moved');
    const listed = (await t.admin.get('/api/branches')).body.branches;
    assert.deepEqual(listed.find((b) => b.code === 'Merkez'), { code: 'Merkez', name: 'Kapalıçarşı Merkez' });

    // Typing the new display name assigns the original code.
    const viaName = await newUser(t.admin, 'kapalıçarşı merkez');
    assert.equal(viaName.status, 201);
    assert.equal((await User.findOne({ email: viaName.email }).lean()).branch, 'Merkez');

    const audit = await AuditLog.findOne({ action: 'branch.rename', resourceId: 'Merkez' }).lean();
    assert.ok(audit, 'rename is audited');
  });

  it('two concurrent renames to the same name: exactly one wins, the other gets 409', async () => {
    const t = await harness.tenant({ branches: ['Merkez', 'Kadıköy', 'Bakırköy'] });
    const results = await Promise.all([
      t.admin.patch(`/api/branches/${encodeURIComponent('Kadıköy')}`, { name: 'Anadolu Yakası' }),
      t.admin.patch(`/api/branches/${encodeURIComponent('Bakırköy')}`, { name: '  anadolu   yakası ' }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(results.find((r) => r.status === 409).body.code, 'BRANCH_NAME_IN_USE');
    assert.equal(await Branch.countDocuments({ businessId: t.businessId, nameKey: branchKey('Anadolu Yakası') }), 1);
  });

  it('a rename and a new branch with the same name cannot both succeed', async () => {
    const t = await harness.tenant({ branches: ['Merkez'] });
    const [renamed, created] = await Promise.allSettled([
      t.admin.patch('/api/branches/Merkez', { name: 'Galata' }),
      resolveBranchCode(t.businessId, 'galata'),
    ]);
    const renameOk = renamed.status === 'fulfilled' && renamed.value.status === 200;
    assert.equal(created.status, 'fulfilled');
    // Either the rename won (the new assignment resolves to Merkez) or the new branch won (the rename was refused).
    assert.equal(created.value, renameOk ? 'Merkez' : 'galata');
    const holders = await Branch.countDocuments({ businessId: t.businessId, $or: [{ codeKey: 'galata' }, { nameKey: 'galata' }] });
    assert.equal(holders, 1);
  });

  it('a rename may not take another branch\'s code or name; only admins rename', async () => {
    const t = await harness.tenant({ branches: ['Merkez', 'Kadıköy'] });
    const clash = await t.admin.patch('/api/branches/Merkez', { name: '  kadıköy ' });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'BRANCH_NAME_IN_USE');
    const manager = await t.branch.Merkez.manager.patch('/api/branches/Merkez', { name: 'Yeni Ad' });
    assert.equal(manager.status, 403);
    const missing = await t.admin.patch('/api/branches/Yok', { name: 'Yeni Ad' });
    assert.equal(missing.status, 404);
    const empty = await t.admin.patch('/api/branches/Merkez', { name: '   ' });
    assert.equal(empty.status, 400);
  });

  it('branches of another business are invisible', async () => {
    const a = await harness.tenant({ branches: ['Merkez'] });
    const b = await harness.tenant({ branches: ['Merkez'] });
    await a.admin.patch('/api/branches/Merkez', { name: 'A Merkez' });
    const listed = (await b.admin.get('/api/branches')).body.branches;
    assert.deepEqual(listed, [{ code: 'Merkez', name: 'Merkez' }]);
  });
});
