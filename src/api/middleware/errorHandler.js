'use strict';

// Central error handler (v2.md §16.3 error contract). Maps DomainError subclasses
// to their HTTP status + { error: { code, message, details } } envelope, and any
// unexpected error to a generic 500 (without leaking internals).

const { DomainError } = require('../../domain/errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof DomainError) {
    return res.status(err.httpStatus).json({
      error: { code: err.code, message: err.message, details: err.details || {} },
    });
  }
  // Unexpected: log server-side, return an opaque 500.
  console.error('[api] unhandled error:', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} },
  });
}

module.exports = { errorHandler };
