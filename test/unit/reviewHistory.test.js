'use strict';

// Phase 5.2 unit test — ReviewHistory domain snapshot factory. Pure domain.

const { test } = require('node:test');
const assert = require('node:assert');
const { createReviewHistory } = require('../../src/domain/review/ReviewHistory');

const TS = '2026-01-01T00:00:00.000Z';

function base(overrides = {}) {
  return createReviewHistory({
    id: 'rh-1',
    reviewItemId: 'ri-1',
    datasetVersionId: 'v1',
    reviewRound: 1,
    status: 'REVIEWED',
    decision: 'ACCEPT',
    note: null,
    reviewerId: 'u1',
    reviewerName: 'Alice',
    timestamp: TS,
    ...overrides,
  });
}

test('valid REVIEWED snapshots for each decision', () => {
  for (const d of ['ACCEPT', 'REJECT', 'NEEDS_FIX']) {
    const h = base({ decision: d });
    assert.strictEqual(h.status, 'REVIEWED');
    assert.strictEqual(h.decision, d);
  }
});

test('valid non-REVIEWED snapshots have null decision', () => {
  assert.strictEqual(base({ status: 'UNREVIEWED', decision: null, reviewerId: null, reviewerName: null }).decision, null);
  assert.strictEqual(base({ status: 'IN_REVIEW', decision: null, reviewerId: null, reviewerName: null }).decision, null);
});

test('invalid status rejected', () => {
  assert.throws(() => base({ status: 'DONE' }), /status is not a valid ReviewStatus/);
});

test('invalid decision rejected', () => {
  assert.throws(() => base({ status: 'REVIEWED', decision: 'MAYBE' }), /decision/);
});

test('invalid status/decision combinations rejected', () => {
  assert.throws(() => base({ status: 'UNREVIEWED', decision: 'ACCEPT' }), /must have a null decision/);
  assert.throws(() => base({ status: 'IN_REVIEW', decision: 'REJECT' }), /must have a null decision/);
  assert.throws(() => base({ status: 'REVIEWED', decision: null }), /requires a valid decision/);
});

test('required string fields validated', () => {
  for (const field of ['id', 'reviewItemId', 'datasetVersionId', 'timestamp']) {
    assert.throws(() => base({ [field]: '' }), new RegExp(field));
    assert.throws(() => base({ [field]: undefined }), new RegExp(field));
  }
});

test('reviewRound must be a positive integer', () => {
  for (const bad of [0, -1, 1.5, '1', null, undefined, NaN]) {
    assert.throws(() => base({ reviewRound: bad }), /reviewRound/);
  }
  assert.strictEqual(base({ reviewRound: 4 }).reviewRound, 4);
});

test('null reviewer: both fields null', () => {
  const h = base({ reviewerId: null, reviewerName: null });
  assert.strictEqual(h.reviewerId, null);
  assert.strictEqual(h.reviewerName, null);
});

test('valid reviewer round-trips', () => {
  const h = base({ reviewerId: 'u9', reviewerName: 'Bob' });
  assert.strictEqual(h.reviewerId, 'u9');
  assert.strictEqual(h.reviewerName, 'Bob');
});

test('half-populated reviewer rejected', () => {
  assert.throws(() => base({ reviewerId: 'u1', reviewerName: null }), /both/);
  assert.throws(() => base({ reviewerId: null, reviewerName: 'Alice' }), /both/);
  assert.throws(() => base({ reviewerId: 'u1', reviewerName: '' }), /both/);
});

test('note is null or string', () => {
  assert.strictEqual(base({ note: null }).note, null);
  assert.strictEqual(base({ note: 'snapshot note' }).note, 'snapshot note');
  assert.throws(() => base({ note: 123 }), /note must be a string/);
});

test('result is frozen and drops unknown fields', () => {
  const h = base({ bogus: 'x', updatedAt: 'nope' });
  assert.ok(Object.isFrozen(h));
  assert.strictEqual(h.bogus, undefined);
  assert.strictEqual(h.updatedAt, undefined);
  assert.deepStrictEqual(Object.keys(h), [
    'id', 'reviewItemId', 'datasetVersionId', 'reviewRound', 'status',
    'decision', 'note', 'reviewerId', 'reviewerName', 'timestamp',
  ]);
});

test('snapshot copies scalar values; later input mutation does not affect it', () => {
  const input = {
    id: 'rh-2', reviewItemId: 'ri-2', datasetVersionId: 'v1', reviewRound: 1,
    status: 'REVIEWED', decision: 'ACCEPT', note: 'orig', reviewerId: 'u1',
    reviewerName: 'Alice', timestamp: TS,
  };
  const h = createReviewHistory(input);
  input.decision = 'REJECT';
  input.note = 'changed';
  input.reviewerName = 'Mallory';
  input.reviewRound = 99;
  assert.strictEqual(h.decision, 'ACCEPT');
  assert.strictEqual(h.note, 'orig');
  assert.strictEqual(h.reviewerName, 'Alice');
  assert.strictEqual(h.reviewRound, 1);
});
