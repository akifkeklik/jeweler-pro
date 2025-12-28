/**
 * Error handling middleware
 * Tüm hataları burada yönet
 */
const errorHandler = (err, req, res, next) => {
  const status = err.statusCode || 500;
  const message = err.message || 'Sunucuda bir hata oluştu';

  console.error(`🔴 [${new Date().toISOString()}] Error: ${message}`);

  // MongoDB validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
    return res.status(400).json({
      error: 'Validation hatası',
      details: messages,
    });
  }

  // MongoDB cast error
  if (err.name === 'CastError') {
    return res.status(400).json({
      error: 'Geçersiz ID formatı',
    });
  }

  // Duplicate key error (MongoDB)
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(409).json({
      error: `Bu ${field} zaten kayıtlı`,
    });
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
