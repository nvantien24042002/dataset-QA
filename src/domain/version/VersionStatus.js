'use strict';

// DatasetVersion status + transition rules (v2.md §11.2, §11.4, §22, INV-05).
// The version state machine allows only DRAFT → READY and READY → ARCHIVED.
// Once READY (or ARCHIVED) a version is immutable; changes require a new version.

const { ImmutableVersionError } = require('../errors');

const VersionStatus = Object.freeze({
  DRAFT: 'DRAFT',
  READY: 'READY',
  ARCHIVED: 'ARCHIVED',
});

const ALLOWED = Object.freeze({
  DRAFT: ['READY'],
  READY: ['ARCHIVED'],
  ARCHIVED: [],
});

function isValidStatus(status) {
  return Object.prototype.hasOwnProperty.call(ALLOWED, status);
}

// READY/ARCHIVED versions may not have their content mutated (INV-05).
function isImmutable(status) {
  return status === VersionStatus.READY || status === VersionStatus.ARCHIVED;
}

function canTransition(from, to) {
  return isValidStatus(from) && isValidStatus(to) && ALLOWED[from].includes(to);
}

function assertCanTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new ImmutableVersionError(`Illegal version status transition: ${from} → ${to}`, {
      from,
      to,
    });
  }
}

module.exports = { VersionStatus, ALLOWED, isValidStatus, isImmutable, canTransition, assertCanTransition };
