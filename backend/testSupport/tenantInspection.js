/**
 * Test-only: wraps a tenant-guarded model so the TEST's own inspection
 * queries (assertions such as `Product.findById(id)`) are marked with an
 * explicit tenant-guard bypass. Production code never receives the wrapper:
 * requests made through the HTTP API still go through the real, guarded
 * model, so the guard keeps protecting every code path under test.
 */
const QUERY_METHODS = new Set([
  'find', 'findOne', 'findById', 'findOneAndUpdate', 'findByIdAndUpdate', 'findOneAndDelete',
  'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
  'countDocuments', 'exists', 'distinct', 'aggregate',
]);
const REASON = 'test-inspection';

function inspect(Model) {
  return new Proxy(Model, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || !QUERY_METHODS.has(prop) || typeof value !== 'function') return value;
      return (...args) => {
        const result = value.apply(target, args);
        if (result && typeof result.setOptions === 'function') result.setOptions({ skipTenantGuard: REASON });
        else if (result && typeof result.option === 'function') result.option({ skipTenantGuard: REASON });
        return result;
      };
    },
  });
}

module.exports = { inspect };
