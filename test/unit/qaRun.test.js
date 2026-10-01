'use strict';

// Phase 4 — Step 1 unit test: QARun model and status machine (v2.md §6, §22).

const { test } = require('node:test');
const assert = require('node:assert');
const { ValidationError, ConflictError } = require('../../src/domain/errors');
const {
  QARunStatus,
  isValidStatus,
  isTerminal,
  canTransition,
  assertCanTransition,
  createQARun,
} = require('../../src/domain/qa/QARun');

const T0 = '2026-10-01T10:00:00.000Z';
const T1 = '2026-10-01T10:00:05.000Z';

const base = (overrides = {}) => ({
  id: 'run-1',
  datasetVersionId: 'ver-1',
  rulesVersion: 'v2-qa-1',
  status: QARunStatus.PENDING,
  ...overrides,
});

// --- Status vocabulary + transitions ---

test('QARunStatus is PENDING, RUNNING, COMPLETED, FAILED', () => {
  assert.deepStrictEqual(Object.values(QARunStatus), ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']);
  assert.ok(Object.isFrozen(QARunStatus));
});

test('allowed transitions: PENDING → RUNNING → COMPLETED | FAILED', () => {
  assert.strictEqual(canTransition('PENDING', 'RUNNING'), true);
  assert.strictEqual(canTransition('RUNNING', 'COMPLETED'), true);
  assert.strictEqual(canTransition('RUNNING', 'FAILED'), true);
});

test('illegal transitions are rejected', () => {
  for (const [from, to] of [
    ['PENDING', 'COMPLETED'],
    ['PENDING', 'FAILED'],
    ['RUNNING', 'PENDING'],
    ['COMPLETED', 'RUNNING'],
    ['FAILED', 'RUNNING'],
    ['COMPLETED', 'FAILED'],
    ['PENDING', 'BOGUS'],
  ]) {
    assert.strictEqual(canTransition(from, to), false, `${from} → ${to}`);
    assert.throws(() => assertCanTransition(from, to), ConflictError, `${from} → ${to}`);
  }
});

test('COMPLETED and FAILED are terminal', () => {
  assert.strictEqual(isTerminal('COMPLETED'), true);
  assert.strictEqual(isTerminal('FAILED'), true);
  assert.strictEqual(isTerminal('PENDING'), false);
  assert.strictEqual(isTerminal('RUNNING'), false);
  assert.strictEqual(isValidStatus('DONE'), false);
});

// --- Valid creation ---

test('creates a PENDING run with null timestamps and summary', () => {
  const run = createQARun(base());
  assert.deepStrictEqual({ ...run }, {
    id: 'run-1',
    datasetVersionId: 'ver-1',
    rulesVersion: 'v2-qa-1',
    status: 'PENDING',
    startedAt: null,
    completedAt: null,
    summary: null,
  });
});

test('creates a RUNNING run with startedAt only', () => {
  const run = createQARun(base({ status: QARunStatus.RUNNING, startedAt: T0 }));
  assert.strictEqual(run.startedAt, T0);
  assert.strictEqual(run.completedAt, null);
});

test('creates COMPLETED and FAILED runs with both timestamps', () => {
  for (const status of [QARunStatus.COMPLETED, QARunStatus.FAILED]) {
    const run = createQARun(base({ status, startedAt: T0, completedAt: T1 }));
    assert.strictEqual(run.status, status);
    assert.strictEqual(run.completedAt, T1);
  }
});

test('summary is copied and frozen', () => {
  const summary = { totalIssues: 3 };
  const run = createQARun(base({ status: QARunStatus.COMPLETED, startedAt: T0, completedAt: T1, summary }));
  summary.totalIssues = 99;
  assert.strictEqual(run.summary.totalIssues, 3);
  assert.ok(Object.isFrozen(run));
  assert.ok(Object.isFrozen(run.summary));
});

// --- Required fields + invalid values ---

test('required fields are enforced', () => {
  for (const field of ['id', 'datasetVersionId', 'rulesVersion']) {
    assert.throws(() => createQARun(base({ [field]: undefined })), ValidationError, field);
    assert.throws(() => createQARun(base({ [field]: '' })), ValidationError, field);
  }
});

test('invalid status is rejected', () => {
  assert.throws(() => createQARun(base({ status: 'DONE' })), ValidationError);
  assert.throws(() => createQARun(base({ status: undefined })), ValidationError);
});

test('timestamps must match status', () => {
  assert.throws(() => createQARun(base({ startedAt: T0 })), /PENDING/);
  assert.throws(() => createQARun(base({ status: 'RUNNING' })), /RUNNING/);
  assert.throws(
    () => createQARun(base({ status: 'RUNNING', startedAt: T0, completedAt: T1 })),
    /RUNNING/
  );
  assert.throws(() => createQARun(base({ status: 'COMPLETED', startedAt: T0 })), /COMPLETED/);
  assert.throws(() => createQARun(base({ status: 'FAILED', completedAt: T1 })), /FAILED/);
});

test('timestamps must be non-empty strings when present', () => {
  assert.throws(
    () => createQARun(base({ status: 'RUNNING', startedAt: 123 })),
    /startedAt must be a non-empty string/
  );
});

test('summary must be a plain object or null', () => {
  const done = { status: 'COMPLETED', startedAt: T0, completedAt: T1 };
  assert.throws(() => createQARun(base({ ...done, summary: [] })), /summary/);
  assert.throws(() => createQARun(base({ ...done, summary: 'x' })), /summary/);
});

test('a QARun carries no review fields', () => {
  const run = createQARun(base());
  for (const key of ['decision', 'reviewer', 'reviewStatus']) {
    assert.ok(!(key in run), key);
  }
});
