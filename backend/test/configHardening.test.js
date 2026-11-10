/**
 * Configuration hardening regression tests (pure unit tests, no database).
 *
 * M2  one canonical NODE_ENV interpretation for every module
 * L4  canonical origin representation (CORS, CSRF, start-up validation, e-mail links)
 * L5  loopback detection in every equivalent spelling
 * L7  topology evaluation and credential redaction (live servers: securityRemediationV2.test.js)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { resolveEnvironment, canonicalizeProcessEnvironment, isStrictEnvironment } = require('../config/environment');
const { validateRuntimeConfig, isLocalHostname } = require('../config/runtimeConfig');
const { getAuthConfig } = require('../config/authConfig');
const { canonicalizeOrigin, isAllowedOrigin, getAllowedOrigins, corsOriginCallback } = require('../config/origins');
const { requireCsrfHeader, requireJsonSameOrigin } = require('../middleware/csrf');
const errorHandler = require('../middleware/errorHandler');
const emailService = require('../services/emailService');
const { isLoopbackIp, isLoopbackHostname, auditIpPrefix } = require('../utils/ipAddress');
const { evaluateTopology, redactConnectionString } = require('../config/databaseCapabilities');

const secret = crypto.randomBytes(48).toString('hex');
const validProd = (extra = {}) => ({
  NODE_ENV: 'production',
  JWT_SECRET: secret,
  MONGO_URI: 'mongodb://db.internal:27017/jeweler?replicaSet=rs0',
  CORS_ORIGIN: 'https://erp.example.com',
  APP_URL: 'https://erp.example.com',
  TRUST_PROXY: '1',
  ...extra,
});

/** Temporarily replaces process.env keys (undefined deletes). */
function withEnv(patch, fn) {
  const saved = {};
  for (const key of Object.keys(patch)) {
    saved[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function captureErrorResponse(error) {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const origError = console.error;
  console.error = () => {};
  try {
    errorHandler(error, { method: 'GET', originalUrl: '/api/x' }, res);
  } finally {
    console.error = origError;
  }
  return res;
}

const PRODUCTION_SPELLINGS = ['production', ' production', 'production ', ' Production ', 'PRODUCTION', '\tproduction\n'];
const UNSUPPORTED = ['prod', 'staging', 'production1', 'prod uction', 'Producción', 'dev'];

describe('M2 — canonical NODE_ENV', () => {
  for (const spelling of PRODUCTION_SPELLINGS) {
    describe(`NODE_ENV=${JSON.stringify(spelling)}`, () => {
      it('is normalised to production', () => {
        const env = resolveEnvironment({ NODE_ENV: spelling });
        assert.equal(env.name, 'production');
        assert.equal(env.valid, true);
        assert.equal(env.strict, true);
      });

      it('start-up validation applies every production rule', () => {
        const result = validateRuntimeConfig(validProd({ NODE_ENV: spelling }));
        assert.equal(result.environment, 'production');
        assert.deepEqual(result.errors, []);
        const insecure = validateRuntimeConfig(validProd({ NODE_ENV: spelling, AUTH_COOKIE_SECURE: 'false', APP_URL: '' }));
        assert.ok(insecure.errors.some((e) => /AUTH_COOKIE_SECURE/.test(e)), JSON.stringify(insecure.errors));
        assert.ok(insecure.errors.some((e) => /APP_URL/.test(e)));
      });

      it('refresh cookies are Secure, even if AUTH_COOKIE_SECURE=false slipped through', () => {
        withEnv({ NODE_ENV: spelling, AUTH_COOKIE_SECURE: undefined }, () => assert.equal(getAuthConfig().cookie.secure, true));
        withEnv({ NODE_ENV: spelling, AUTH_COOKIE_SECURE: 'false' }, () => assert.equal(getAuthConfig().cookie.secure, true));
      });

      it('error responses expose neither internal messages nor stack traces', () => {
        withEnv({ NODE_ENV: spelling }, () => {
          const res = captureErrorResponse(new Error('db password=hunter2 at 10.0.0.5'));
          assert.equal(res.statusCode, 500);
          assert.equal(res.body.error, 'Sunucuda beklenmeyen bir hata oluştu');
          assert.equal(res.body.stack, undefined);
          assert.equal(JSON.stringify(res.body).includes('hunter2'), false);
        });
      });

      it('reset links never fall back to CORS_ORIGIN / localhost', () => {
        withEnv({ NODE_ENV: spelling, APP_URL: undefined, CORS_ORIGIN: 'http://localhost:8080' }, () => {
          assert.equal(emailService.getAppBaseUrl(), '');
        });
      });
    });
  }

  for (const value of UNSUPPORTED) {
    it(`unsupported NODE_ENV=${JSON.stringify(value)} is refused at start-up and fails closed until then`, () => {
      const { errors } = validateRuntimeConfig(validProd({ NODE_ENV: value }));
      assert.ok(errors.some((e) => /NODE_ENV/.test(e)), JSON.stringify(errors));
      assert.equal(resolveEnvironment({ NODE_ENV: value }).strict, true);
      withEnv({ NODE_ENV: value, AUTH_COOKIE_SECURE: 'false', APP_URL: undefined }, () => {
        assert.equal(getAuthConfig().cookie.secure, true);
        assert.equal(emailService.getAppBaseUrl(), '');
        const res = captureErrorResponse(new Error('internal detail'));
        assert.equal(res.body.error, 'Sunucuda beklenmeyen bir hata oluştu');
        assert.equal(res.body.stack, undefined);
      });
    });
  }

  it('development / test keep their behaviour (dev stack traces, test messages, non-Secure local cookies)', () => {
    withEnv({ NODE_ENV: ' Development ', AUTH_COOKIE_SECURE: undefined }, () => {
      assert.equal(isStrictEnvironment(), false);
      assert.equal(getAuthConfig().cookie.secure, false);
      const res = captureErrorResponse(new Error('visible in dev'));
      assert.equal(res.body.error, 'visible in dev');
      assert.ok(res.body.stack);
    });
    withEnv({ NODE_ENV: 'test' }, () => {
      const res = captureErrorResponse(new Error('visible in test'));
      assert.equal(res.body.error, 'visible in test');
      assert.equal(res.body.stack, undefined);
    });
    withEnv({ NODE_ENV: undefined }, () => assert.equal(resolveEnvironment().name, 'development'));
  });

  it('canonicalizeProcessEnvironment rewrites NODE_ENV for third-party code', () => {
    const env = { NODE_ENV: ' Production ' };
    assert.equal(canonicalizeProcessEnvironment(env).name, 'production');
    assert.equal(env.NODE_ENV, 'production');
    const bad = { NODE_ENV: 'prod' };
    canonicalizeProcessEnvironment(bad);
    assert.equal(bad.NODE_ENV, 'prod', 'unsupported values are not silently "fixed"');
  });

  it('no backend module compares process.env.NODE_ENV directly (only config/environment.js reads it)', () => {
    const root = path.join(__dirname, '..');
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'test', '.git'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js') && /process\.env\.NODE_ENV|env\.NODE_ENV/.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    assert.deepEqual(offenders.map((p) => p.replace(/\\/g, '/')), ['config/environment.js']);
  });
});

describe('L4 — canonical origins', () => {
  it('canonicalises scheme/host case, default ports and one trailing slash', () => {
    assert.equal(canonicalizeOrigin('https://ERP.Example.com'), 'https://erp.example.com');
    assert.equal(canonicalizeOrigin('https://erp.example.com:443'), 'https://erp.example.com');
    assert.equal(canonicalizeOrigin('http://localhost:80/'), 'http://localhost');
    assert.equal(canonicalizeOrigin('HTTPS://erp.example.com/'), 'https://erp.example.com');
    assert.equal(canonicalizeOrigin('https://bücher.example'), 'https://xn--bcher-kva.example');
  });

  it('rejects malformed origins', () => {
    for (const bad of [
      'null', '*', '', '   ', 'erp.example.com', 'ftp://erp.example.com', 'javascript:alert(1)',
      'https://erp.example.com/path', 'https://erp.example.com//', 'https://erp.example.com/?', 'https://erp.example.com/#x',
      'https://user:pw@erp.example.com', 'https://erp.example.com@evil.example', 'https://erp.example.com\r\nX: y',
      'https://erp.example.com evil', 'https://', 'https://erp.example.com:99999', undefined, null, 42, ['https://erp.example.com'],
    ]) {
      assert.equal(canonicalizeOrigin(bad), null, JSON.stringify(bad));
    }
  });

  it('strict allowlist: look-alike origins are not allowed', () => {
    const env = { CORS_ORIGIN: 'https://erp.example.com' };
    for (const origin of ['https://erp.example.com.evil.example', 'https://evil-erp.example.com', 'http://erp.example.com', 'https://erp.example.com:8443', 'https://sub.erp.example.com']) {
      assert.equal(isAllowedOrigin(origin, env), false, origin);
    }
    assert.equal(isAllowedOrigin('https://erp.example.com', env), true);
  });

  it('configured trailing slash and request Origin agree in CORS and in both CSRF guards', () => {
    withEnv({ CORS_ORIGIN: 'https://erp.example.com/ , https://Admin.Example.com:443' }, () => {
      assert.deepEqual(getAllowedOrigins(), ['https://erp.example.com', 'https://admin.example.com']);
      for (const origin of ['https://erp.example.com', 'https://admin.example.com']) {
        let corsAllowed;
        corsOriginCallback(origin, (err, allowed) => { corsAllowed = allowed; });
        assert.equal(corsAllowed, true, `CORS ${origin}`);

        const okRes = { status() { throw new Error(`CSRF rejected ${origin}`); } };
        let passed = 0;
        requireCsrfHeader({ headers: { origin, 'x-requested-with': 'XMLHttpRequest' } }, okRes, () => { passed += 1; });
        requireJsonSameOrigin({ headers: { origin, 'content-type': 'application/json' } }, okRes, () => { passed += 1; });
        assert.equal(passed, 2);
      }
      for (const origin of ['https://evil.example', 'null', 'https://erp.example.com/x']) {
        let corsAllowed;
        corsOriginCallback(origin, (err, allowed) => { corsAllowed = allowed; });
        assert.equal(corsAllowed, false, `CORS ${origin}`);
        const res = { code: null, status(c) { this.code = c; return this; }, json() { return this; } };
        requireJsonSameOrigin({ headers: { origin, 'content-type': 'application/json' } }, res, () => assert.fail('must reject'));
        assert.equal(res.code, 403, origin);
      }
    });
  });

  it('start-up validation uses the same canonical form (APP_URL vs CORS_ORIGIN with trailing slash / case)', () => {
    assert.deepEqual(validateRuntimeConfig(validProd({ CORS_ORIGIN: 'https://ERP.example.com/', APP_URL: 'https://erp.example.com' })).errors, []);
    assert.ok(validateRuntimeConfig(validProd({ CORS_ORIGIN: 'https://erp.example.com/app' })).errors.some((e) => /CORS_ORIGIN/.test(e)));
    assert.ok(validateRuntimeConfig(validProd({ CORS_ORIGIN: 'https://erp.example.com,null' })).errors.some((e) => /CORS_ORIGIN/.test(e)));
  });
});

describe('L5 — loopback detection', () => {
  const LOOPBACK_HOSTS = [
    'localhost', 'LOCALHOST', 'localhost.', 'localhost..', 'LocalHost.', 'app.localhost', 'app.localhost.',
    'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
    '127.0.0.1', '127.1', '127.0.1', '127.255.255.254', '2130706433', '0x7f.1', '0x7f000001', '0177.0.0.1',
    '0.0.0.0', '0', '[::1]', '::1', '[0:0:0:0:0:0:0:1]', '[0000::0001]', '[::]', '[::ffff:127.0.0.1]',
    '[::ffff:7f00:1]', '::ffff:127.0.0.2', '[::127.0.0.1]', '[::1%25lo0]',
  ];
  const PUBLIC_HOSTS = ['erp.example.com', '10.0.0.1', '192.168.1.1', '128.0.0.1', '[2001:db8::1]', '[::ffff:8.8.8.8]', 'localhost.example.com', 'mylocalhost', '127.0.0.1.nip.io'];

  it('recognises every equivalent loopback / unspecified spelling', () => {
    for (const host of LOOPBACK_HOSTS) assert.equal(isLoopbackHostname(host), true, host);
    for (const host of PUBLIC_HOSTS) assert.equal(isLoopbackHostname(host), false, host);
    assert.equal(isLocalHostname('LOCALHOST.'), true, 'runtimeConfig delegates to the shared implementation');
    assert.equal(isLoopbackIp('::ffff:127.0.0.1'), true);
    assert.equal(isLoopbackIp('::ffff:10.0.0.1'), false);
  });

  it('production refuses APP_URL / CORS_ORIGIN pointing at any loopback representation', () => {
    for (const host of ['localhost.', 'LOCALHOST', 'app.localhost.', '127.1', '2130706433', '0x7f.1', '[::1]', '[0:0:0:0:0:0:0:1]', '[::ffff:127.0.0.1]', '0.0.0.0', '[::]', 'localhost.localdomain']) {
      const url = `https://${host}`;
      const { errors } = validateRuntimeConfig(validProd({ APP_URL: url, CORS_ORIGIN: url }));
      assert.ok(errors.some((e) => /localhost|loopback/.test(e)), `${url}: ${JSON.stringify(errors)}`);
    }
  });

  it('audit IP prefixes minimise addresses consistently', () => {
    assert.equal(auditIpPrefix('203.0.113.77'), '203.0.113.0/24');
    assert.equal(auditIpPrefix('::ffff:203.0.113.77'), '203.0.113.0/24');
    assert.equal(auditIpPrefix('2001:db8:1234:5678::1'), '2001:db8:1234::/48');
    assert.equal(auditIpPrefix('garbage'), null);
  });
});

describe('L7 — MongoDB topology evaluation (pure)', () => {
  it('classifies hello replies', () => {
    assert.equal(evaluateTopology({ setName: 'rs0', maxWireVersion: 21, logicalSessionTimeoutMinutes: 30 }).supported, true);
    assert.equal(evaluateTopology({ msg: 'isdbgrid', maxWireVersion: 21, logicalSessionTimeoutMinutes: 30 }).topology, 'sharded');
    assert.equal(evaluateTopology({ msg: 'isdbgrid', maxWireVersion: 21, logicalSessionTimeoutMinutes: 30 }).supported, true);
    const standalone = evaluateTopology({ isWritablePrimary: true, maxWireVersion: 21, logicalSessionTimeoutMinutes: 30 });
    assert.equal(standalone.supported, false);
    assert.equal(standalone.topology, 'standalone');
    assert.equal(evaluateTopology({ setName: 'rs0', maxWireVersion: 6, logicalSessionTimeoutMinutes: 30 }).supported, false, 'MongoDB 3.6');
    assert.equal(evaluateTopology({ msg: 'isdbgrid', maxWireVersion: 7, logicalSessionTimeoutMinutes: 30 }).supported, false, 'sharded 4.0');
    assert.equal(evaluateTopology({ setName: 'rs0', maxWireVersion: 21 }).supported, false, 'no logical sessions');
    assert.equal(evaluateTopology({ setName: 'rs0', maxWireVersion: 21, logicalSessionTimeoutMinutes: 30, arbiterOnly: true }).supported, false);
    assert.equal(evaluateTopology(null).supported, false);
  });

  it('redacts connection strings and credentials from error messages', () => {
    const uri = 'mongodb+srv://jeweler_app:S3cr%40tPass@cluster0.example.net/prod?replicaSet=rs0';
    const message = `failed to connect to ${uri}; auth for jeweler_app:S3cr%40tPass failed (password S3cr@tPass)`;
    const redacted = redactConnectionString(message, uri);
    for (const leaked of ['S3cr%40tPass', 'S3cr@tPass', 'jeweler_app', uri]) {
      assert.equal(redacted.includes(leaked), false, `${leaked} leaked: ${redacted}`);
    }
    assert.equal(redactConnectionString('mongodb://u:p4ss@host/db unreachable', undefined), 'mongodb://<redacted>@host/db unreachable');
  });
});
