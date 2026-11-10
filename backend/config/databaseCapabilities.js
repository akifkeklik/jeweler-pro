/**
 * MongoDB deployment requirements (security finding L7).
 *
 * User management (last-admin guard, admin recovery, reset-token issuance)
 * and sales rely on multi-document transactions for their security
 * invariants. Transactions require a replica set (MongoDB ≥ 4.0) or a sharded
 * cluster (≥ 4.2); a standalone server rejects them.
 *
 * Detection is done against the connected server, not by inspecting the URI
 * string (a "?replicaSet=" parameter proves nothing about the server):
 *   1. `hello` reports the actual topology, wire version and session support;
 *   2. a real read-only transaction with the same read/write concerns as the
 *      guarded code paths is executed and committed.
 *
 * Production refuses to start when either step fails. Development and test
 * only warn, so a local standalone mongod keeps working for UI work.
 * Error messages never contain the connection string or credentials.
 */
const MIN_WIRE_VERSION = Object.freeze({ replicaSet: 7, sharded: 8 }); // 4.0 / 4.2
const PROBE_COLLECTION = 'startup_transaction_probe';

class TransactionSupportError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TransactionSupportError';
    this.code = 'MONGO_TRANSACTIONS_UNAVAILABLE';
    this.details = details;
  }
}

/** Classifies a `hello` / `isMaster` reply. Pure function (unit-testable). */
function evaluateTopology(hello) {
  if (!hello || typeof hello !== 'object') {
    return { supported: false, topology: 'unknown', reason: 'Sunucu topolojisi okunamadı' };
  }
  const wire = Number(hello.maxWireVersion) || 0;
  const sessions = hello.logicalSessionTimeoutMinutes !== undefined && hello.logicalSessionTimeoutMinutes !== null;
  let topology = 'standalone';
  if (hello.msg === 'isdbgrid') topology = 'sharded';
  else if (typeof hello.setName === 'string' && hello.setName) topology = 'replicaSet';

  if (topology === 'standalone') {
    return { supported: false, topology, wireVersion: wire, reason: 'Bağımsız (standalone) MongoDB sunucusu transaction desteklemez' };
  }
  if (wire < MIN_WIRE_VERSION[topology]) {
    return { supported: false, topology, wireVersion: wire, reason: `MongoDB sürümü ${topology === 'sharded' ? '4.2' : '4.0'} veya üzeri olmalıdır` };
  }
  if (!sessions) {
    return { supported: false, topology, wireVersion: wire, reason: 'Sunucu mantıksal oturumları (logical sessions) desteklemiyor' };
  }
  if (topology === 'replicaSet' && hello.arbiterOnly) {
    return { supported: false, topology, wireVersion: wire, reason: 'Bağlanılan üye bir arbiter' };
  }
  return { supported: true, topology, wireVersion: wire, reason: null };
}

async function readHello(db) {
  const admin = db.admin();
  try {
    return await admin.command({ hello: 1 });
  } catch (error) {
    // Servers older than 4.4.2 / 5.0 only know the legacy name.
    if (error?.code === 59 || /no such (cmd|command)/i.test(String(error?.message))) {
      return admin.command({ isMaster: 1 });
    }
    throw error;
  }
}

/** Executes and commits a tiny read-only transaction; throws if the server refuses. */
async function probeTransaction(connection) {
  const session = await connection.startSession();
  try {
    await session.withTransaction(async () => {
      await connection.db.collection(PROBE_COLLECTION).findOne({}, { session });
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  } finally {
    await session.endSession();
  }
}

/**
 * Verifies transaction support of `connection` (a connected mongoose
 * Connection). Returns the evaluation; throws TransactionSupportError when
 * `required` and unsupported, otherwise logs a warning.
 */
async function verifyTransactionSupport(connection, { required, logger = console } = {}) {
  let evaluation;
  try {
    evaluation = evaluateTopology(await readHello(connection.db));
    if (evaluation.supported) {
      try {
        await probeTransaction(connection);
      } catch (error) {
        evaluation = {
          ...evaluation,
          supported: false,
          reason: `Deneme transaction'ı başarısız oldu (${safeErrorCode(error)})`,
        };
      }
    }
  } catch (error) {
    evaluation = { supported: false, topology: 'unknown', reason: `Topoloji sorgulanamadı (${safeErrorCode(error)})` };
  }

  if (!evaluation.supported) {
    const message = `MongoDB transaction desteği yok: ${evaluation.reason}. `
      + 'Replica set (≥4.0) veya sharded cluster (≥4.2) gereklidir (tespit edilen: '
      + `${evaluation.topology}).`;
    if (required) throw new TransactionSupportError(message, { topology: evaluation.topology });
    logger.warn(`[db] UYARI: ${message} Kullanıcı yönetimi ve satış işlemleri çalışmayacaktır.`);
  }
  return evaluation;
}

/** Error code / name only — server error messages can echo hosts or input. */
function safeErrorCode(error) {
  const code = error?.codeName || error?.code || error?.name || 'bilinmeyen hata';
  return String(code).replace(/[^\w.-]/g, '').slice(0, 64) || 'bilinmeyen hata';
}

/**
 * Removes a MongoDB connection string and any credentials from a message
 * before it is logged.
 */
function redactConnectionString(message, uri) {
  let text = String(message ?? '');
  const secrets = new Set();
  if (uri) {
    secrets.add(String(uri));
    const match = String(uri).match(/^mongodb(?:\+srv)?:\/\/([^@/]+)@/i);
    if (match) {
      secrets.add(match[1]);
      const [user, pass] = match[1].split(':');
      for (const part of [user, pass]) {
        if (part && part.length >= 3) {
          secrets.add(part);
          try { secrets.add(decodeURIComponent(part)); } catch { /* keep raw only */ }
        }
      }
    }
  }
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret) text = text.split(secret).join('<redacted>');
  }
  return text.replace(/(mongodb(?:\+srv)?:\/\/)[^\s/@]+@/gi, '$1<redacted>@');
}

module.exports = {
  MIN_WIRE_VERSION,
  TransactionSupportError,
  evaluateTopology,
  probeTransaction,
  verifyTransactionSupport,
  redactConnectionString,
};
