'use strict';

// Canonical QAIssue (v2.md §6, §14.3 qa_issues; v1.md §17 issue schema). Pure
// domain: no I/O and no rule logic. The rule that emits an issue chooses its
// type and severity; this factory only checks that the issue is well-formed.
//
// A QAIssue belongs to one QARun and one DatasetVersion (INV-09). Whether a
// referenced annotation belongs to the same version (INV-10) needs the
// version's data, so it is checked where issues are produced or persisted, not
// here. A QAIssue carries no review status, decision, or reviewer (INV-11).

const { ValidationError } = require('../errors');
const { isValidIssueType, isValidSeverity } = require('./QAVocabulary');

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function createQAIssue(fields) {
  const {
    id,
    qaRunId,
    datasetVersionId,
    type,
    severity,
    imageId,
    annotationId = null,
    categoryId = null,
    reason,
    details = {},
    createdAt,
  } = fields;

  if (!isNonEmptyString(id)) throw new ValidationError('QAIssue.id is required');
  if (!isNonEmptyString(qaRunId)) {
    throw new ValidationError('QAIssue.qaRunId is required', { id });
  }
  if (!isNonEmptyString(datasetVersionId)) {
    throw new ValidationError('QAIssue.datasetVersionId is required', { id });
  }
  if (!isValidIssueType(type)) {
    throw new ValidationError('QAIssue.type is not a valid QAIssueType', { id, type });
  }
  if (!isValidSeverity(severity)) {
    throw new ValidationError('QAIssue.severity is not a valid QASeverity', { id, severity });
  }
  // imageId must be supplied explicitly. It is null only for issues with no
  // image, e.g. dataset-level CLASS_IMBALANCE (v1.md §12, §17).
  if (!Object.prototype.hasOwnProperty.call(fields, 'imageId')) {
    throw new ValidationError('QAIssue.imageId must be provided (use null for dataset-level issues)', {
      id,
    });
  }
  if (imageId !== null && !isNonEmptyString(imageId)) {
    throw new ValidationError('QAIssue.imageId must be a non-empty string or null', { id });
  }
  if (annotationId !== null && !isNonEmptyString(annotationId)) {
    throw new ValidationError('QAIssue.annotationId must be a non-empty string or null', { id });
  }
  if (!isNonEmptyString(reason)) {
    throw new ValidationError('QAIssue.reason is required', { id });
  }
  if (!isPlainObject(details)) {
    throw new ValidationError('QAIssue.details must be an object', { id });
  }
  if (!isNonEmptyString(createdAt)) {
    throw new ValidationError('QAIssue.createdAt is required', { id });
  }

  return Object.freeze({
    id,
    qaRunId,
    datasetVersionId,
    type,
    severity,
    imageId,
    annotationId,
    categoryId,
    reason,
    details: Object.freeze({ ...details }),
    createdAt,
  });
}

module.exports = { createQAIssue };
