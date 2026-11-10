/**
 * Tenant guard: a query on a tenant-scoped model MUST be filtered by
 * `businessId`. Forgetting the filter is the classic multi-tenant data leak,
 * so this plugin turns it from a silent leak into a loud programming error.
 *
 * - Query middleware (find*, update*, delete*, count, distinct, replace):
 *   the filter must contain `businessId` (top level or inside `$and`) as a
 *   non-empty string, `{ $eq: string }` or `{ $in: [string, ...] }`.
 * - Aggregate middleware: the first pipeline stage must be a `$match` that
 *   satisfies the same rule.
 * - Writes: new documents must carry a non-empty `businessId` (the schema
 *   path is `required`, the guard double-checks `insertMany`).
 *
 * Models whose primary key embeds the businessId (`${businessId}|...`, e.g.
 * AccountBalance, MetalStock) register with `{ compositeId: true }`: a filter
 * on such an `_id` is tenant-scoped by construction and is accepted.
 *
 * Legitimate exceptions (global id-uniqueness probes, composite ids that
 * already embed the businessId, operator migrations) opt out explicitly and
 * must say why: `.setOptions({ skipTenantGuard: 'composite-id' })`. A bare
 * `true` is rejected so every bypass is self-documenting and greppable.
 *
 * Raw driver access (`Model.collection.*`) is not intercepted; it is used only
 * by migration scripts, which operate on all tenants by design.
 */
const QUERY_OPS = [
  'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
  'countDocuments', 'distinct',
];

class TenantScopeError extends Error {
  constructor(modelName, operation) {
    super(`Tenant guard: ${modelName}.${operation} sorgusu businessId filtresi içermiyor`);
    this.name = 'TenantScopeError';
    this.code = 'TENANT_SCOPE_MISSING';
    this.statusCode = 500;
    this.expose = false;
  }
}

const isTenantValue = (value) => typeof value === 'string' && value.trim() !== '';

function hasTenantCondition(value) {
  if (isTenantValue(value)) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (isTenantValue(value.$eq)) return true;
  if (Array.isArray(value.$in) && value.$in.length > 0 && value.$in.every(isTenantValue)) return true;
  return false;
}

const isCompositeId = (value) => typeof value === 'string' && /^[^|\s]+\|/.test(value);

function hasCompositeIdCondition(value) {
  if (isCompositeId(value)) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (isCompositeId(value.$eq)) return true;
  return Array.isArray(value.$in) && value.$in.length > 0 && value.$in.every(isCompositeId);
}

function filterHasTenant(filter, { compositeId = false } = {}) {
  if (!filter || typeof filter !== 'object') return false;
  if (hasTenantCondition(filter.businessId)) return true;
  if (compositeId && hasCompositeIdCondition(filter._id)) return true;
  if (Array.isArray(filter.$and)) return filter.$and.some((part) => filterHasTenant(part, { compositeId }));
  return false;
}

function validBypass(reason) {
  return typeof reason === 'string' && reason.trim().length >= 3;
}

function tenantGuard(schema, { compositeId = false } = {}) {
  schema.pre(QUERY_OPS, function guardQuery() {
    const options = this.getOptions();
    if (validBypass(options.skipTenantGuard)) return;
    if (!filterHasTenant(this.getFilter(), { compositeId })) {
      throw new TenantScopeError(this.model.modelName, this.op);
    }
  });

  schema.pre('aggregate', function guardAggregate() {
    if (validBypass(this.options?.skipTenantGuard)) return;
    const [first] = this.pipeline();
    if (!first || !first.$match || !filterHasTenant(first.$match, { compositeId })) {
      throw new TenantScopeError(this._model?.modelName || 'Model', 'aggregate');
    }
  });

  schema.pre('insertMany', function guardInsertMany(next, docs) {
    const list = Array.isArray(docs) ? docs : [docs];
    if (list.some((doc) => !isTenantValue(doc?.businessId))) {
      return next(new TenantScopeError(this.modelName, 'insertMany'));
    }
    return next();
  });
}

module.exports = tenantGuard;
module.exports.TenantScopeError = TenantScopeError;
module.exports.filterHasTenant = filterHasTenant;
