'use strict';

// Canonical QARun (v2.md §6, §14.3 qa_runs) and its status machine (v2.md
// §22 "QARun"): PENDING -> RUNNING -> COMPLETED | FAILED. Pure domain: no I/O,
// no rule execution. Running the rules and persisting runs are later Phase 4
// steps.

const { ValidationError, ConflictError } = require('../errors');

const QARunStatus = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

const ALLOWED = Object.freeze({
  PENDING: Object.freeze(['RUNNING']),
  RUNNING: Object.freeze(['COMPLETED', 'FAILED']),
  COMPLETED: Object.freeze([]),
  FAILED: Object.freeze([]),
});

function isValidStatus(status) {
  return Object.prototype.hasOwnProperty.call(ALLOWED, status);
}

function isTerminal(status) {
  return status === QARunStatus.COMPLETED || status === QARunStatus.FAILED;
}

function canTransition(from, to) {
  return isValidStatus(from) && isValidStatus(to) && ALLOWED[from].includes(to);
}

function assertCanTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new ConflictError(`Illegal QA run status transition: ${from} → ${to}`, { from, to });
  }
}

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// Timestamps are ISO-8601 TEXT in storage (schema.sql); the domain only checks
// presence/absence per status, not the string format.
function assertTimestampsMatchStatus({ id, status, startedAt, completedAt }) {
  const started = startedAt != null;
  const completed = completedAt != null;
  if (started && !isNonEmptyString(startedAt)) {
    throw new ValidationError('QARun.startedAt must be a non-empty string or null', { id });
  }
  if (completed && !isNonEmptyString(completedAt)) {
    throw new ValidationError('QARun.completedAt must be a non-empty string or null', { id });
  }
  if (status === QARunStatus.PENDING && (started || completed)) {
    throw new ValidationError('A PENDING QARun has no startedAt or completedAt', { id, status });
  }
  if (status === QARunStatus.RUNNING && (!started || completed)) {
    throw new ValidationError('A RUNNING QARun requires startedAt and no completedAt', {
      id,
      status,
    });
  }
  if (isTerminal(status) && (!started || !completed)) {
    throw new ValidationError(`A ${status} QARun requires startedAt and completedAt`, {
      id,
      status,
    });
  }
}

function createQARun({
  id,
  datasetVersionId,
  rulesVersion,
  status,
  startedAt = null,
  completedAt = null,
  summary = null,
}) {
  if (!isNonEmptyString(id)) throw new ValidationError('QARun.id is required');
  if (!isNonEmptyString(datasetVersionId)) {
    throw new ValidationError('QARun.datasetVersionId is required', { id });
  }
  if (!isNonEmptyString(rulesVersion)) {
    throw new ValidationError('QARun.rulesVersion is required', { id });
  }
  if (!isValidStatus(status)) {
    throw new ValidationError('QARun.status is not a valid QARunStatus', { id, status });
  }
  assertTimestampsMatchStatus({ id, status, startedAt, completedAt });
  if (summary !== null && !isPlainObject(summary)) {
    throw new ValidationError('QARun.summary must be an object or null', { id });
  }

  return Object.freeze({
    id,
    datasetVersionId,
    rulesVersion,
    status,
    startedAt,
    completedAt,
    summary: summary === null ? null : Object.freeze({ ...summary }),
  });
}

module.exports = {
  QARunStatus,
  ALLOWED,
  isValidStatus,
  isTerminal,
  canTransition,
  assertCanTransition,
  createQARun,
};
