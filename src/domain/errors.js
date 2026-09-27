'use strict';

// Domain/application error types (v2.md §16.3 error contract). Each carries a
// machine `code` + HTTP `httpStatus` so the API error handler can map them to
// the {error:{code,message,details}} envelope without leaking stack traces.

class DomainError extends Error {
  constructor(code, message, httpStatus, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

class BadRequestError extends DomainError {
  constructor(message, details = {}) {
    super('BAD_REQUEST', message, 400, details);
  }
}

class NotFoundError extends DomainError {
  constructor(message, details = {}) {
    super('NOT_FOUND', message, 404, details);
  }
}

class ConflictError extends DomainError {
  constructor(message, details = {}) {
    super('CONFLICT', message, 409, details);
  }
}

class ImmutableVersionError extends DomainError {
  constructor(message, details = {}) {
    super('VERSION_IMMUTABLE', message, 409, details);
  }
}

class ValidationError extends DomainError {
  constructor(message, details = {}) {
    super('VALIDATION_ERROR', message, 422, details);
  }
}

module.exports = {
  DomainError,
  BadRequestError,
  NotFoundError,
  ConflictError,
  ImmutableVersionError,
  ValidationError,
};
