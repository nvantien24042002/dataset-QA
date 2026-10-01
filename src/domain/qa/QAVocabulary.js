'use strict';

// QA vocabulary (v2.md §6, §6.1; v1.md §17, §18). Pure enums only: no rule
// logic, no thresholds, and no automatic type -> severity mapping. Each QA rule
// module (later Phase 4 steps) decides the severity of the issues it emits.
//
// QA severity is a dataset-quality signal, never a human review decision
// (INV-11). Geometry validation facts (VALID / DEGENERATE / INVALID and
// GeometryIssueCode) are a separate vocabulary in src/domain/geometry and are
// not QA issue types (INV-43).

// The nine V1 rules preserved by V2 (v2.md §6.1). v2.md §6.2 names no further
// QA issue types for the 2D geometry checks, so none are added here.
const QAIssueType = Object.freeze({
  MISSING_ANNOTATION: 'MISSING_ANNOTATION',
  SMALL_OBJECT: 'SMALL_OBJECT',
  TRUNCATED: 'TRUNCATED',
  CLASS_IMBALANCE: 'CLASS_IMBALANCE',
  INVALID_IMAGE_REFERENCE: 'INVALID_IMAGE_REFERENCE',
  INVALID_CATEGORY_REFERENCE: 'INVALID_CATEGORY_REFERENCE',
  INVALID_BBOX: 'INVALID_BBOX',
  OUT_OF_BOUNDS_BBOX: 'OUT_OF_BOUNDS_BBOX',
  INVALID_IMAGE_DIMENSION: 'INVALID_IMAGE_DIMENSION',
});

// Four severity levels (v1.md §18). LOW is defined but no current V1 rule emits
// it (v1.md §18, "Về mức LOW"); it stays reserved.
const QASeverity = Object.freeze({
  INFO: 'INFO',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
});

// Severity rank used for ordering issues high -> low (v1.md §18 table).
const QASeverityRank = Object.freeze({
  [QASeverity.HIGH]: 4,
  [QASeverity.MEDIUM]: 3,
  [QASeverity.LOW]: 2,
  [QASeverity.INFO]: 1,
});

const hasValue = (enumObject, value) => Object.values(enumObject).includes(value);

function isValidIssueType(type) {
  return hasValue(QAIssueType, type);
}

function isValidSeverity(severity) {
  return hasValue(QASeverity, severity);
}

module.exports = {
  QAIssueType,
  QASeverity,
  QASeverityRank,
  isValidIssueType,
  isValidSeverity,
};
