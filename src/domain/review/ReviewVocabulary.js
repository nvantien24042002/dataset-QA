'use strict';

// Review vocabulary (v2.md §7 Review Model, §22 Review state machine; INV-12..14).
// Pure enums + validators only: no rule logic, no persistence, no transition
// policy (the ReviewItem state machine owns transitions). Mirrors the QA
// vocabulary convention (src/domain/qa/QAVocabulary.js).
//
// A human review Decision is separate from any QA severity signal (INV-11): QA
// severity never becomes a decision here.

// Workflow status (v2.md §7, §22): UNREVIEWED -> IN_REVIEW -> REVIEWED.
const ReviewStatus = Object.freeze({
  UNREVIEWED: 'UNREVIEWED',
  IN_REVIEW: 'IN_REVIEW',
  REVIEWED: 'REVIEWED',
});

// Human decision, only valid on a REVIEWED item (v2.md §7; INV-14).
const ReviewDecision = Object.freeze({
  ACCEPT: 'ACCEPT',
  REJECT: 'REJECT',
  NEEDS_FIX: 'NEEDS_FIX',
});

// How the ReviewItem originated (v2.md §7). QA = generated from QA issues;
// MANUAL = created by a human (queue generation is a later Phase 5 step).
const ReviewSource = Object.freeze({
  QA: 'QA',
  MANUAL: 'MANUAL',
});

// Target shape (v2.md §7, INV-34/35). Only image- and annotation-level targets
// exist; there is no dataset-level target type.
const ReviewTargetType = Object.freeze({
  IMAGE: 'IMAGE',
  ANNOTATION: 'ANNOTATION',
});

const hasValue = (enumObject, value) => Object.values(enumObject).includes(value);

function isValidStatus(status) {
  return hasValue(ReviewStatus, status);
}

function isValidDecision(decision) {
  return hasValue(ReviewDecision, decision);
}

function isValidSource(source) {
  return hasValue(ReviewSource, source);
}

function isValidTargetType(targetType) {
  return hasValue(ReviewTargetType, targetType);
}

module.exports = {
  ReviewStatus,
  ReviewDecision,
  ReviewSource,
  ReviewTargetType,
  isValidStatus,
  isValidDecision,
  isValidSource,
  isValidTargetType,
};
