/**
 * Shared HTTP harness for the financial integration tests (real MongoDB
 * replica set, real Express app, real JWTs). Creates isolated tenants with
 * users in one or more branches.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

const uid = () => crypto.randomBytes(5).toString('hex');

function createHarness({ app, signToken, User, hashPassword, password = 'Finance-Harness-Pass-2026' }) {
  let server;
  let baseUrl;
  let passwordHash;

  function request(method, path, { body, token, headers = {} } = {}) {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    if (token) reqHeaders.Authorization = `Bearer ${token}`;
    const payload = body === undefined ? null : JSON.stringify(body);
    if (payload) reqHeaders['Content-Type'] = 'application/json';
    return new Promise((resolve, reject) => {
      const req = http.request(url, { method, headers: reqHeaders, agent: false }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  const clientFor = (token) => ({
    get: (p, headers) => request('GET', p, { token, headers }),
    post: (p, body, headers) => request('POST', p, { token, body, headers }),
    put: (p, body, headers) => request('PUT', p, { token, body, headers }),
    del: (p, headers) => request('DELETE', p, { token, headers }),
  });

  async function user({ role, businessId, branch, customPermissions = [] }) {
    const doc = await User.create({
      email: `${role}_${uid()}@harness.test`, name: `Test ${role}`, passwordHash, role, branch, businessId, customPermissions, active: true,
    });
    return { doc, api: clientFor(signToken(doc, 900)) };
  }

  /**
   * A fresh business. `branches` → for each branch a manager and a staff
   * member (plus one admin in the first branch).
   */
  async function tenant({ branches = ['Merkez'] } = {}) {
    const businessId = `biz_h_${uid()}`;
    const admin = await user({ role: 'admin', businessId, branch: branches[0] });
    const byBranch = {};
    for (const branch of branches) {
      const [manager, manager2, staff] = await Promise.all([
        user({ role: 'manager', businessId, branch }),
        user({ role: 'manager', businessId, branch }),
        user({ role: 'staff', businessId, branch }),
      ]);
      byBranch[branch] = { manager: manager.api, manager2: manager2.api, staff: staff.api, users: { manager: manager.doc, manager2: manager2.doc, staff: staff.doc } };
    }
    return { businessId, branches, admin: admin.api, adminUser: admin.doc, branch: byBranch, user: (opts) => user({ businessId, ...opts }) };
  }

  return {
    async start() {
      passwordHash = await hashPassword(password);
      server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    },
    async stop() {
      if (server) await new Promise((r) => server.close(r));
    },
    request,
    tenant,
  };
}

async function mustOk(res, label) {
  assert.ok([200, 201].includes(res.status), `${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

function expectError(res, status, code, label = '') {
  assert.equal(res.status, status, `${label} expected ${status} ${code || ''}: ${res.status} ${JSON.stringify(res.body)}`);
  if (code) assert.equal(res.body?.code, code, `${label}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function accountBalances(api) {
  const res = await api.get('/api/ledger/accounts');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const map = new Map(res.body.map((a) => [`${a.account}|${a.unit}`, a.balance]));
  return (account, unit = 'TRY') => map.get(`${account}|${unit}`) ?? 0;
}

async function assertReconciled(api, label) {
  const res = await api.get('/api/ledger/reconciliation');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const problems = {
    ledger: res.body.ledger.discrepancies,
    inventory: res.body.inventory.discrepancies,
    transfers: res.body.transfers?.discrepancies,
    pos: res.body.pos?.discrepancies,
  };
  assert.equal(res.body.ok, true, `${label}: ${JSON.stringify(problems)}`);
  assert.equal(res.body.ledger.trialBalance.TRY ?? 0, 0, `${label}: trial balance`);
  return res.body;
}

module.exports = { createHarness, mustOk, expectError, accountBalances, assertReconciled, uid };
