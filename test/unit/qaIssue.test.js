'use strict';

// Phase 4 — Step 1 unit test: QAIssue model (v2.md §6, §14.3; v1.md §17).

const { test } = require('node:test');
const assert = require('node:assert');
const { ValidationError } = require('../../src/domain/errors');
const { QAIssueType, QASeverity } = require('../../src/domain/qa/QAVocabulary');
const { createQAIssue } = require('../../src/domain/qa/QAIssue');

const base = (overrides = {}) => ({
  id: 'issue-1',
  qaRunId: 'run-1',
  datasetVersionId: 'ver-1',
  type: QAIssueType.SMALL_OBJECT,
  severity: QASeverity.MEDIUM,
  imageId: 'img-1',
  annotationId: 'ann-1',
  categoryId: 2,
  reason: 'Object may be too small; please check.',
  details: { bbox: [10, 10, 18, 40] },
  createdAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

// --- Valid creation ---

test('creates an annotation-level issue with all fields', () => {
  const issue = createQAIssue(base());
  assert.deepStrictEqual({ ...issue, details: { ...issue.details } }, {
    id: 'issue-1',
    qaRunId: 'run-1',
    datasetVersionId: 'ver-1',
    type: 'SMALL_OBJECT',
    severity: 'MEDIUM',
    imageId: 'img-1',
    annotationId: 'ann-1',
    categoryId: 2,
    reason: 'Object may be too small; please check.',
    details: { bbox: [10, 10, 18, 40] },
    createdAt: '2026-10-01T10:00:00.000Z',
  });
});

test('accepts every QAIssueType and QASeverity', () => {
  for (const type of Object.values(QAIssueType)) {
    for (const severity of Object.values(QASeverity)) {
      assert.strictEqual(createQAIssue(base({ type, severity })).type, type);
    }
  }
});

// --- Optional annotationId / categoryId, nullable imageId ---

test('annotationId and categoryId default to null when omitted', () => {
  const fields = base({ type: QAIssueType.MISSING_ANNOTATION, severity: QASeverity.INFO });
  delete fields.annotationId;
  delete fields.categoryId;
  const issue = createQAIssue(fields);
  assert.strictEqual(issue.annotationId, null);
  assert.strictEqual(issue.categoryId, null);
  assert.strictEqual(issue.imageId, 'img-1');
});

test('imageId may be explicitly null for a dataset-level issue', () => {
  const issue = createQAIssue(base({
    type: QAIssueType.CLASS_IMBALANCE,
    severity: QASeverity.HIGH,
    imageId: null,
    annotationId: null,
    categoryId: 1,
  }));
  assert.strictEqual(issue.imageId, null);
  assert.strictEqual(issue.categoryId, 1);
});

test('imageId must be provided explicitly', () => {
  const fields = base();
  delete fields.imageId;
  assert.throws(() => createQAIssue(fields), /imageId must be provided/);
});

test('imageId and annotationId must be non-empty strings when present', () => {
  assert.throws(() => createQAIssue(base({ imageId: '' })), /imageId/);
  assert.throws(() => createQAIssue(base({ imageId: 7 })), /imageId/);
  assert.throws(() => createQAIssue(base({ annotationId: '' })), /annotationId/);
  assert.throws(() => createQAIssue(base({ annotationId: 7 })), /annotationId/);
});

test('details default to an empty object', () => {
  const fields = base();
  delete fields.details;
  assert.deepStrictEqual({ ...createQAIssue(fields).details }, {});
});

// --- Required fields + invalid enums ---

test('required string fields are enforced', () => {
  for (const field of ['id', 'qaRunId', 'datasetVersionId', 'reason', 'createdAt']) {
    assert.throws(() => createQAIssue(base({ [field]: undefined })), ValidationError, field);
    assert.throws(() => createQAIssue(base({ [field]: '' })), ValidationError, field);
  }
});

test('invalid type is rejected', () => {
  assert.throws(() => createQAIssue(base({ type: 'ZERO_AREA' })), /type/);
  assert.throws(() => createQAIssue(base({ type: undefined })), /type/);
});

test('invalid severity is rejected', () => {
  assert.throws(() => createQAIssue(base({ severity: 'CRITICAL' })), /severity/);
  assert.throws(() => createQAIssue(base({ severity: undefined })), /severity/);
});

test('details must be a plain object', () => {
  assert.throws(() => createQAIssue(base({ details: null })), /details/);
  assert.throws(() => createQAIssue(base({ details: [] })), /details/);
});

// --- Immutability + review separation ---

test('issue and details are frozen; details is a copy', () => {
  const details = { bbox: [1, 2, 3, 4] };
  const issue = createQAIssue(base({ details }));
  details.extra = true;
  assert.ok(!('extra' in issue.details));
  assert.ok(Object.isFrozen(issue));
  assert.ok(Object.isFrozen(issue.details));
});

test('a QAIssue carries no review status, decision, or reviewer (INV-11)', () => {
  const issue = createQAIssue(base());
  for (const key of ['decision', 'reviewer', 'reviewerId', 'reviewStatus', 'status']) {
    assert.ok(!(key in issue), key);
  }
});

test('unknown input fields are not copied onto the issue', () => {
  const issue = createQAIssue(base({ decision: 'ACCEPT' }));
  assert.ok(!('decision' in issue));
});
