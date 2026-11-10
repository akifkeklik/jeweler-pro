/**
 * The API contract (docs/openapi.json) must describe exactly the routes the
 * Express app serves: a new endpoint without documentation, or documentation
 * of a removed endpoint, fails the build.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.JWT_SECRET ||= 'openapi-contract-secret-with-more-than-32-chars';
process.env.NODE_ENV = 'test';

const app = require('../server');
const { listRoutes } = require('../scripts/listRoutes');
const spec = require(path.join(__dirname, '..', '..', 'docs', 'openapi.json'));

const documented = () => Object.entries(spec.paths)
  .flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`))
  .sort();

test('every served route is documented and every documented route is served', () => {
  const served = listRoutes(app);
  assert.ok(served.length > 100, `route discovery found only ${served.length} routes`);
  const docs = documented();
  assert.deepEqual(served.filter((r) => !docs.includes(r)), [], 'routes missing from docs/openapi.json');
  assert.deepEqual(docs.filter((r) => !served.includes(r)), [], 'documented routes that no longer exist');
});

test('every operation has a summary, a tag and a unique operationId', () => {
  const ids = new Set();
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      assert.ok(op.summary, `${method} ${p}: summary`);
      assert.ok(op.tags?.length, `${method} ${p}: tag`);
      assert.ok(!ids.has(op.operationId), `${method} ${p}: duplicate operationId ${op.operationId}`);
      ids.add(op.operationId);
    }
  }
});
