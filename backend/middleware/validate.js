/**
 * Request validation with zod. A failing body is answered with
 * 400 VALIDATION_FAILED and the list of offending fields; on success
 * `req.body` is replaced by the parsed (trimmed, typed, unknown-keys-free)
 * value, so handlers never see unvalidated input.
 */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      return res.status(400).json({
        error: 'İstek doğrulanamadı',
        code: 'VALIDATION_FAILED',
        fields: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    req.body = result.data;
    return next();
  };
}

module.exports = { validateBody };
