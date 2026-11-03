/**
 * Centralized Express error handler.
 * Known client errors keep their useful messages; unexpected production errors
 * are returned with a generic message so internal details are not disclosed.
 */
const errorHandler = (err, req, res, next) => {
  const candidateStatus = Number(err.statusCode);
  const status = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus < 600
    ? candidateStatus
    : 500;

  console.error(`[${new Date().toISOString()}] Request failed`, {
    method: req.method,
    path: req.originalUrl,
    status,
    error: err,
  });

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors || {})
      .map((item) => item.message)
      .filter(Boolean);

    return res.status(400).json({
      error: 'Validation hatası',
      details: messages,
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'Geçersiz ID formatı' });
  }

  if (err.code === 11000) {
    const duplicateFields = err.keyPattern || err.keyValue || {};
    const field = Object.keys(duplicateFields)[0] || 'kayıt';
    return res.status(409).json({ error: `Bu ${field} zaten kayıtlı` });
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const message = status >= 500 && isProduction
    ? 'Sunucuda beklenmeyen bir hata oluştu'
    : (err.message || 'Sunucuda bir hata oluştu');

  return res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
