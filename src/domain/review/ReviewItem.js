'use strict';

// Canonical ReviewItem (v2.md §7 Review Model, §14.3 review_items) and its state
// machine (v2.md §22 Review): UNREVIEWED -> IN_REVIEW -> REVIEWED. Pure domain:
// no I/O, no persistence, no history/audit side effects. Transitions return a
// NEW frozen ReviewItem; the input is never mutated.
//
// submitReview here is ONLY the domain state transition IN_REVIEW -> REVIEWED.
// It does NOT write ReviewHistory, SQLite, or AuditEvent (Phase 7 orchestrates
// successful submit + history + audit atomically).
//
// Review is a human-decision layer over an immutable READY dataset version: a
// ReviewItem never mutates annotation geometry/category (INV-18) and belongs to
// exactly one DatasetVersion (INV-19).

const { ValidationError, ConflictError } = require('../errors');
const {
  ReviewStatus,
  ReviewDecision,
  ReviewSource,
  ReviewTargetType,
  isValidStatus,
  isValidDecision,
  isValidSource,
  isValidTargetType,
} = require('./ReviewVocabulary');

// Allowed status transitions (v2.md §22). REVIEWED is terminal in Phase 5 (no
// reopen). No self-transitions.
const ALLOWED = Object.freeze({
  UNREVIEWED: Object.freeze(['IN_REVIEW']),
  IN_REVIEW: Object.freeze(['REVIEWED']),
  REVIEWED: Object.freeze([]),
});

function canTransition(from, to) {
  return isValidStatus(from) && isValidStatus(to) && ALLOWED[from].includes(to);
}

function assertCanTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new ConflictError(`Illegal review status transition: ${from} → ${to}`, { from, to });
  }
}

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

// Build the immutable target value object (v2.md §7; INV-34/35). IMAGE: imageId
// required, annotationId must be null. ANNOTATION: both required.
function buildTarget(target) {
  if (!isPlainObject(target)) {
    throw new ValidationError('ReviewItem.target is required');
  }
  const { type, imageId, annotationId = null } = target;
  if (!isValidTargetType(type)) {
    throw new ValidationError('ReviewItem.target.type is not a valid ReviewTargetType', { type });
  }
  if (!isNonEmptyString(imageId)) {
    throw new ValidationError('ReviewItem.target.imageId is required', { type });
  }
  if (type === ReviewTargetType.IMAGE) {
    if (annotationId !== null) {
      throw new ValidationError('IMAGE target.annotationId must be null', { type });
    }
  } else if (!isNonEmptyString(annotationId)) {
    // ReviewTargetType.ANNOTATION
    throw new ValidationError('ANNOTATION target.annotationId is required', { type });
  }
  return Object.freeze({ type, imageId, annotationId });
}

// Build the immutable reviewer value object { id, name }, or null (v2.md §7).
// Reviewer is optional: an UNREVIEWED item needs no reviewer.
function buildReviewer(reviewer) {
  if (reviewer === null || reviewer === undefined) return null;
  if (!isPlainObject(reviewer)) {
    throw new ValidationError('ReviewItem.reviewer must be an object { id, name } or null');
  }
  if (!isNonEmptyString(reviewer.id)) {
    throw new ValidationError('ReviewItem.reviewer.id is required when a reviewer is present');
  }
  if (!isNonEmptyString(reviewer.name)) {
    throw new ValidationError('ReviewItem.reviewer.name is required when a reviewer is present');
  }
  return Object.freeze({ id: reviewer.id, name: reviewer.name });
}

// Enforce the status/decision pairing (INV-12/13/14): a decision exists iff the
// status is REVIEWED, and then it must be a valid ReviewDecision.
function assertStatusDecisionConsistent(status, decision) {
  if (status === ReviewStatus.REVIEWED) {
    if (!isValidDecision(decision)) {
      throw new ValidationError('A REVIEWED ReviewItem requires a valid decision', {
        status,
        decision,
      });
    }
  } else if (decision !== null) {
    throw new ValidationError(`A ${status} ReviewItem must have a null decision`, {
      status,
      decision,
    });
  }
}

function createReviewItem({
  id,
  datasetVersionId,
  target,
  source,
  status,
  decision = null,
  reviewer = null,
  note = null,
  reviewRound,
  createdAt,
  updatedAt,
}) {
  if (!isNonEmptyString(id)) throw new ValidationError('ReviewItem.id is required');
  if (!isNonEmptyString(datasetVersionId)) {
    throw new ValidationError('ReviewItem.datasetVersionId is required', { id });
  }
  if (!isValidSource(source)) {
    throw new ValidationError('ReviewItem.source is not a valid ReviewSource', { id, source });
  }
  if (!isValidStatus(status)) {
    throw new ValidationError('ReviewItem.status is not a valid ReviewStatus', { id, status });
  }
  if (!isPositiveInteger(reviewRound)) {
    throw new ValidationError('ReviewItem.reviewRound must be a positive integer', {
      id,
      reviewRound,
    });
  }
  if (!isNonEmptyString(createdAt)) {
    throw new ValidationError('ReviewItem.createdAt must be a non-empty string', { id });
  }
  if (!isNonEmptyString(updatedAt)) {
    throw new ValidationError('ReviewItem.updatedAt must be a non-empty string', { id });
  }
  if (note !== null && typeof note !== 'string') {
    throw new ValidationError('ReviewItem.note must be a string or null', { id });
  }

  const builtTarget = buildTarget(target);
  const builtReviewer = buildReviewer(reviewer);
  assertStatusDecisionConsistent(status, decision);

  return Object.freeze({
    id,
    datasetVersionId,
    target: builtTarget,
    source,
    status,
    decision: status === ReviewStatus.REVIEWED ? decision : null,
    reviewer: builtReviewer,
    note,
    reviewRound,
    createdAt,
    updatedAt,
  });
}

// --- State transitions (pure; return a NEW item, never mutate the input) ---

// UNREVIEWED -> IN_REVIEW. Decision stays null (INV-13). Reviewer is NOT required
// at start; an optional reviewer/note already on the item is preserved.
function startReview(item, { updatedAt } = {}) {
  assertCanTransition(item.status, ReviewStatus.IN_REVIEW);
  return createReviewItem({
    ...item,
    status: ReviewStatus.IN_REVIEW,
    decision: null,
    updatedAt: updatedAt != null ? updatedAt : item.updatedAt,
  });
}

// IN_REVIEW -> REVIEWED with a required decision (INV-14). Domain state change
// ONLY: no history/audit/persistence here (Phase 7 orchestrates those).
function submitReview(item, decision, { reviewer, note, updatedAt } = {}) {
  assertCanTransition(item.status, ReviewStatus.REVIEWED);
  if (!isValidDecision(decision)) {
    throw new ValidationError('submitReview requires a valid decision', { decision });
  }
  return createReviewItem({
    ...item,
    status: ReviewStatus.REVIEWED,
    decision,
    reviewer: reviewer !== undefined ? reviewer : item.reviewer,
    note: note !== undefined ? note : item.note,
    updatedAt: updatedAt != null ? updatedAt : item.updatedAt,
  });
}

module.exports = {
  ReviewStatus,
  ReviewDecision,
  ReviewSource,
  ReviewTargetType,
  ALLOWED,
  canTransition,
  assertCanTransition,
  createReviewItem,
  startReview,
  submitReview,
};
