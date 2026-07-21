'use strict';

/**
 * Centralised Express error handler.
 * Must be mounted last (after all routes) in app.js.
 */
function errorHandler(err, req, res, _next) {
  console.error('[error]', err.message, err.stack);

  const status = err.status || 500;
  return res.status(status).json({
    error: err.message || 'Internal server error',
  });
}

module.exports = { errorHandler };
