/**
 * Lists every HTTP route the Express app serves as "METHOD /path" with
 * OpenAPI-style parameters ({id}). Used by test/openapiContract.test.js to
 * keep docs/openapi.json complete, and by operators:
 *   node scripts/listRoutes.js
 */
function joinPath(base, path) {
  const joined = `${base}/${path}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

const fs = require('node:fs');
const path = require('node:path');

// Express 5 does not keep a router's mount path on its layer; the candidate
// prefixes are read from server.js and confirmed with the layer's matcher.
const MOUNT_PREFIXES = [...fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')
  .matchAll(/app\.use\(\s*["'](\/[^"']*)["']/g)].map((m) => m[1]);

function mountPath(layer, base) {
  if (typeof layer.path === 'string' && layer.path) return layer.path;
  const matcher = Array.isArray(layer.matchers) ? layer.matchers[0] : null;
  const candidates = MOUNT_PREFIXES
    .filter((prefix) => prefix.startsWith(base || '/'))
    .map((prefix) => prefix.slice((base || '').length) || '/')
    .sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    try {
      if (matcher && matcher(candidate)) return candidate;
    } catch {
      // not this prefix
    }
  }
  return '';
}

function collect(stack, base, out) {
  for (const layer of stack || []) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods || {})) {
        if (method === '_all') continue;
        const path = joinPath(base, layer.route.path).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
        out.add(`${method.toUpperCase()} ${path}`);
      }
    } else if (layer.handle?.stack) {
      collect(layer.handle.stack, joinPath(base, mountPath(layer, base)), out);
    }
  }
  return out;
}

function listRoutes(app) {
  const router = app.router || app._router;
  return [...collect(router.stack, '', new Set())].sort();
}

module.exports = { listRoutes };

if (require.main === module) {
  process.env.JWT_SECRET ||= 'list-routes-only-secret-with-32-plus-characters';
  const app = require('../server');
  for (const route of listRoutes(app)) console.log(route);
  process.exit(0);
}
