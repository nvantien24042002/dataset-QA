'use strict';

// Canonical ReviewHistory (v2.md §8.2 Review History, §14.3 review_history).
// Append-only, point-in-time snapshot of a ReviewItem at the moment of a review
// transition (INV-15/17). Pure domain: no I/O, no persistence.
//
// The factory takes SCALAR values only — never a live ReviewItem reference — so
// the stored snapshot cannot change if the source item is later mutated. The
// reviewer object {id,name} on a ReviewItem is flattened here to the two scalar
// fields reviewerId/reviewerName (v2.md §8.2).
//
// Status/decision pairing is enforced ONLY as snapshot consistency (a snapshot of
// a valid item is always consistent), reusing the same rule as ReviewItem; it is
// not a new workflow. History never mutates a ReviewItem or Annotation (INV-18).

const { ValidationError } = require('../errors');
const { isValidStatus, isValidDecision, ReviewStatus } = require('./ReviewVocabulary');

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

// Mirror of ReviewItem's status/decision rule (INV-12/13/14): decision exists iff
// status is REVIEWED, and then must be a valid ReviewDecision.
function assertStatusDecisionConsistent(status, decision) {
  if (status === ReviewStatus.REVIEWED) {
    if (!isValidDecision(decision)) {
      throw new ValidationError('A REVIEWED ReviewHistory requires a valid decision', {
        status,
        decision,
      });
    }
  } else if (decision !== null) {
    throw new ValidationError(`A ${status} ReviewHistory must have a null decision`, {
      status,
      decision,
    });
  }
}

// Flatten reviewer to scalar fields: both null, or both non-empty strings.
function normalizeReviewer(reviewerId, reviewerName) {
  const hasId = reviewerId !== null && reviewerId !== undefined;
  const hasName = reviewerName !== null && reviewerName !== undefined;
  if (!hasId && !hasName) return { reviewerId: null, reviewerName: null };
  if (!isNonEmptyString(reviewerId) || !isNonEmptyString(reviewerName)) {
    throw new ValidationError(
      'ReviewHistory reviewerId and reviewerName must both be non-empty strings or both null'
    );
  }
  return { reviewerId, reviewerName };
}

function createReviewHistory({
  id,
  reviewItemId,
  datasetVersionId,
  reviewRound,
  status,
  decision = null,
  note = null,
  reviewerId = null,
  reviewerName = null,
  timestamp,
} = {}) {
  if (!isNonEmptyString(id)) throw new ValidationError('ReviewHistory.id is required');
  if (!isNonEmptyString(reviewItemId)) {
    throw new ValidationError('ReviewHistory.reviewItemId is required', { id });
  }
  if (!isNonEmptyString(datasetVersionId)) {
    throw new ValidationError('ReviewHistory.datasetVersionId is required', { id });
  }
  if (!isPositiveInteger(reviewRound)) {
    throw new ValidationError('ReviewHistory.reviewRound must be a positive integer', {
      id,
      reviewRound,
    });
  }
  if (!isValidStatus(status)) {
    throw new ValidationError('ReviewHistory.status is not a valid ReviewStatus', { id, status });
  }
  if (decision !== null && !isValidDecision(decision)) {
    throw new ValidationError('ReviewHistory.decision is not a valid ReviewDecision', {
      id,
      decision,
    });
  }
  if (note !== null && typeof note !== 'string') {
    throw new ValidationError('ReviewHistory.note must be a string or null', { id });
  }
  if (!isNonEmptyString(timestamp)) {
    throw new ValidationError('ReviewHistory.timestamp is required', { id });
  }

  assertStatusDecisionConsistent(status, decision);
  const reviewer = normalizeReviewer(reviewerId, reviewerName);

  // Explicit scalar field copy (no spread of input) so unknown fields never leak.
  return Object.freeze({
    id,
    reviewItemId,
    datasetVersionId,
    reviewRound,
    status,
    decision: status === ReviewStatus.REVIEWED ? decision : null,
    note,
    reviewerId: reviewer.reviewerId,
    reviewerName: reviewer.reviewerName,
    timestamp,
  });
}

module.exports = { createReviewHistory };
