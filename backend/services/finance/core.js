/**
 * Shared foundations of the financial services: domain errors, the tenant
 * context every operation runs in, and the transaction runner.
 */
const mongoose = require('mongoose');
const { DEFAULT_BUSINESS_ID, DEFAULT_BRANCH } = require('../../config/tenancy');

class DomainError extends Error {
  constructor(statusCode, message, code = 'DOMAIN_ERROR', details) {
    super(message);
    this.name = 'DomainError';
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const badRequest = (message, code = 'VALIDATION_ERROR', details) => new DomainError(400, message, code, details);
const notFound = (message, code = 'NOT_FOUND') => new DomainError(404, message, code);
const conflict = (message, code = 'CONFLICT', details) => new DomainError(409, message, code, details);
const unprocessable = (message, code = 'UNPROCESSABLE', details) => new DomainError(422, message, code, details);
const forbidden = (message, code = 'FORBIDDEN') => new DomainError(403, message, code);

/**
 * Tenant context of an authenticated request. Every financial query and
 * write is filtered by `businessId`; branch-bound operations use `branch`.
 */
function tenantContext(req) {
  if (!req?.user?.businessId) throw forbidden('İşletme bağlamı bulunamadı');
  if (!req.user.branch) throw forbidden('Şube bağlamı bulunamadı');
  return Object.freeze({
    businessId: req.user.businessId,
    branch: req.user.branch,
    userId: req.user._id,
    role: req.user.role,
    isAdmin: req.user.role === 'admin',
    permissions: req.user.permissions || [],
    correlationId: req.correlationId || `req-${Date.now()}`,
  });
}

/**
 * Context for direct service calls without an HTTP request (scripts,
 * legacy callers): the original single-tenant business and branch.
 */
function systemContext({ businessId = DEFAULT_BUSINESS_ID, branch = DEFAULT_BRANCH, userId = null, correlationId = 'system' } = {}) {
  return Object.freeze({ businessId, branch, userId, role: 'system', isAdmin: true, permissions: [], correlationId });
}

/** Branch filter for list endpoints: admins see every branch (optionally one), others only their own. */
function branchScope(ctx, requestedBranch) {
  if (ctx.isAdmin) return requestedBranch ? { branch: String(requestedBranch) } : {};
  return { branch: ctx.branch };
}

/**
 * Runs `work(session)` in a snapshot / majority transaction. `work` can be
 * retried by the driver on transient conflicts, so it must only touch the
 * database through `session` and must not have external side effects.
 */
async function runInTransaction(work, { startSession = () => mongoose.startSession() } = {}) {
  const session = await startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Positive integer id from a route/body value, or a 400. */
function parseNumericId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw badRequest(`Geçerli bir ${label} seçilmelidir`, 'INVALID_ID');
  return id;
}

module.exports = {
  DomainError,
  badRequest,
  notFound,
  conflict,
  unprocessable,
  forbidden,
  tenantContext,
  systemContext,
  branchScope,
  runInTransaction,
  parseNumericId,
};
