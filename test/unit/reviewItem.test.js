'use strict';

// Phase 5.1 unit test — ReviewItem domain model + state machine. Pure domain,
// no persistence. Covers construction invariants (INV-12/13/14/19), target
// null-shape (INV-34/35), immutability, and the UNREVIEWED->IN_REVIEW->REVIEWED
// transitions (v2.md §22) with reopen explicitly absent.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  createReviewItem,
  startReview,
  submitReview,
  canTransition,
} = require('../../src/domain/review/ReviewItem');

const TS = '2026-01-01T00:00:00.000Z';

function baseImageItem(overrides = {}) {
  return createReviewItem({
    id: 'ri-1',
    datasetVersionId: 'v1',
    target: { type: 'IMAGE', imageId: 'v1::img::1' },
    source: 'QA',
    status: 'UNREVIEWED',
    reviewRound: 1,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  });
}

function baseAnnotationItem(overrides = {}) {
  return createReviewItem({
    id: 'ri-2',
    datasetVersionId: 'v1',
    target: { type: 'ANNOTATION', imageId: 'v1::img::1', annotationId: 'v1::ann::1' },
    source: 'QA',
    status: 'UNREVIEWED',
    reviewRound: 1,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  });
}

// --- Construction ---

test('valid IMAGE target: annotationId defaults to null', () => {
  const item = baseImageItem();
  assert.strictEqual(item.target.type, 'IMAGE');
  assert.strictEqual(item.target.imageId, 'v1::img::1');
  assert.strictEqual(item.target.annotationId, null);
  assert.strictEqual(item.status, 'UNREVIEWED');
  assert.strictEqual(item.decision, null);
});

test('valid ANNOTATION target: both ids required and present', () => {
  const item = baseAnnotationItem();
  assert.strictEqual(item.target.type, 'ANNOTATION');
  assert.strictEqual(item.target.imageId, 'v1::img::1');
  assert.strictEqual(item.target.annotationId, 'v1::ann::1');
});

test('invalid target type is rejected', () => {
  assert.throws(() => baseImageItem({ target: { type: 'DATASET', imageId: 'x' } }), /target.type/);
});

test('IMAGE target requires imageId', () => {
  assert.throws(() => baseImageItem({ target: { type: 'IMAGE' } }), /imageId is required/);
});

test('IMAGE target rejects a non-null annotationId', () => {
  assert.throws(
    () => baseImageItem({ target: { type: 'IMAGE', imageId: 'i', annotationId: 'a' } }),
    /annotationId must be null/
  );
});

test('ANNOTATION target requires both ids', () => {
  assert.throws(
    () => baseAnnotationItem({ target: { type: 'ANNOTATION', imageId: 'i' } }),
    /annotationId is required/
  );
  assert.throws(
    () => baseAnnotationItem({ target: { type: 'ANNOTATION', annotationId: 'a' } }),
    /imageId is required/
  );
});

test('datasetVersionId is required (INV-19)', () => {
  assert.throws(() => baseImageItem({ datasetVersionId: '' }), /datasetVersionId/);
});

test('source must be valid', () => {
  assert.doesNotThrow(() => baseImageItem({ source: 'MANUAL' }));
  assert.throws(() => baseImageItem({ source: 'AUTO' }), /source/);
});

test('all three statuses construct with a consistent decision', () => {
  assert.strictEqual(baseImageItem({ status: 'UNREVIEWED' }).status, 'UNREVIEWED');
  assert.strictEqual(baseImageItem({ status: 'IN_REVIEW' }).status, 'IN_REVIEW');
  const reviewed = baseImageItem({ status: 'REVIEWED', decision: 'ACCEPT' });
  assert.strictEqual(reviewed.status, 'REVIEWED');
});

test('valid status/decision combinations (INV-12/13/14)', () => {
  for (const d of ['ACCEPT', 'REJECT', 'NEEDS_FIX']) {
    assert.strictEqual(baseImageItem({ status: 'REVIEWED', decision: d }).decision, d);
  }
  assert.strictEqual(baseImageItem({ status: 'UNREVIEWED', decision: null }).decision, null);
  assert.strictEqual(baseImageItem({ status: 'IN_REVIEW', decision: null }).decision, null);
});

test('invalid status/decision combinations are rejected', () => {
  assert.throws(() => baseImageItem({ status: 'UNREVIEWED', decision: 'ACCEPT' }), /null decision/);
  assert.throws(() => baseImageItem({ status: 'IN_REVIEW', decision: 'REJECT' }), /null decision/);
  assert.throws(() => baseImageItem({ status: 'REVIEWED', decision: null }), /requires a valid decision/);
  assert.throws(() => baseImageItem({ status: 'REVIEWED', decision: 'MAYBE' }), /requires a valid decision/);
});

test('reviewRound must be a positive integer', () => {
  for (const bad of [0, -1, 1.5, '1', null, undefined, NaN]) {
    assert.throws(() => baseImageItem({ reviewRound: bad }), /reviewRound/);
  }
  assert.strictEqual(baseImageItem({ reviewRound: 3 }).reviewRound, 3);
});

test('reviewer is optional and immutable when present', () => {
  assert.strictEqual(baseImageItem().reviewer, null);
  const reviewer = { id: 'u1', name: 'Alice' };
  const item = baseImageItem({ reviewer });
  assert.deepStrictEqual(item.reviewer, { id: 'u1', name: 'Alice' });
  assert.ok(Object.isFrozen(item.reviewer));
  // Mutating the source input must not affect the stored reviewer (defensive copy).
  reviewer.name = 'Mallory';
  assert.strictEqual(item.reviewer.name, 'Alice');
});

test('reviewer requires id and name when present', () => {
  assert.throws(() => baseImageItem({ reviewer: { id: 'u1' } }), /reviewer.name/);
  assert.throws(() => baseImageItem({ reviewer: { name: 'Alice' } }), /reviewer.id/);
  assert.throws(() => baseImageItem({ reviewer: 'Alice' }), /reviewer must be an object/);
});

test('note is optional and nullable', () => {
  assert.strictEqual(baseImageItem().note, null);
  assert.strictEqual(baseImageItem({ note: 'looks off' }).note, 'looks off');
  assert.throws(() => baseImageItem({ note: 42 }), /note must be a string/);
});

test('timestamps required as non-empty strings', () => {
  assert.throws(() => baseImageItem({ createdAt: '' }), /createdAt/);
  assert.throws(() => baseImageItem({ updatedAt: undefined }), /updatedAt/);
});

test('result item and its target are frozen; unknown fields do not leak', () => {
  const item = baseImageItem({ bogus: 'nope', target: { type: 'IMAGE', imageId: 'i', extra: 'x' } });
  assert.ok(Object.isFrozen(item));
  assert.ok(Object.isFrozen(item.target));
  assert.strictEqual(item.bogus, undefined);
  assert.strictEqual(item.target.extra, undefined);
  assert.deepStrictEqual(Object.keys(item.target), ['type', 'imageId', 'annotationId']);
});

// --- State machine ---

test('UNREVIEWED -> IN_REVIEW via startReview; decision stays null', () => {
  const started = startReview(baseImageItem());
  assert.strictEqual(started.status, 'IN_REVIEW');
  assert.strictEqual(started.decision, null);
});

test('IN_REVIEW -> REVIEWED via submitReview with each decision', () => {
  for (const d of ['ACCEPT', 'REJECT', 'NEEDS_FIX']) {
    const inReview = startReview(baseImageItem());
    const reviewed = submitReview(inReview, d);
    assert.strictEqual(reviewed.status, 'REVIEWED');
    assert.strictEqual(reviewed.decision, d);
  }
});

test('submitReview without a valid decision fails', () => {
  const inReview = startReview(baseImageItem());
  assert.throws(() => submitReview(inReview), /valid decision/);
  assert.throws(() => submitReview(inReview, null), /valid decision/);
  assert.throws(() => submitReview(inReview, 'MAYBE'), /valid decision/);
});

test('illegal transitions are rejected', () => {
  const unreviewed = baseImageItem();
  const inReview = startReview(unreviewed);
  const reviewed = submitReview(inReview, 'ACCEPT');

  // submit from UNREVIEWED (skipping IN_REVIEW)
  assert.throws(() => submitReview(unreviewed, 'ACCEPT'), /Illegal review status transition/);
  // start from IN_REVIEW / REVIEWED
  assert.throws(() => startReview(inReview), /Illegal review status transition/);
  assert.throws(() => startReview(reviewed), /Illegal review status transition/);
  // submit from REVIEWED (terminal; no reopen)
  assert.throws(() => submitReview(reviewed, 'REJECT'), /Illegal review status transition/);
});

test('no self transitions are allowed', () => {
  assert.strictEqual(canTransition('UNREVIEWED', 'UNREVIEWED'), false);
  assert.strictEqual(canTransition('IN_REVIEW', 'IN_REVIEW'), false);
  assert.strictEqual(canTransition('REVIEWED', 'REVIEWED'), false);
});

test('REVIEWED is terminal: no reopen path exists', () => {
  assert.strictEqual(canTransition('REVIEWED', 'UNREVIEWED'), false);
  assert.strictEqual(canTransition('REVIEWED', 'IN_REVIEW'), false);
  // IN_REVIEW cannot roll back to UNREVIEWED either.
  assert.strictEqual(canTransition('IN_REVIEW', 'UNREVIEWED'), false);
});

test('transitions do not mutate the original item (immutable)', () => {
  const unreviewed = baseImageItem();
  const started = startReview(unreviewed);
  assert.strictEqual(unreviewed.status, 'UNREVIEWED');
  assert.notStrictEqual(started, unreviewed);
  const reviewed = submitReview(started, 'ACCEPT');
  assert.strictEqual(started.status, 'IN_REVIEW');
  assert.strictEqual(started.decision, null);
  assert.notStrictEqual(reviewed, started);
});

test('submit may record reviewer/note without touching target (INV-18)', () => {
  const started = startReview(baseAnnotationItem());
  const reviewed = submitReview(started, 'NEEDS_FIX', {
    reviewer: { id: 'u1', name: 'Alice' },
    note: 'bbox slightly off',
  });
  assert.deepStrictEqual(reviewed.reviewer, { id: 'u1', name: 'Alice' });
  assert.strictEqual(reviewed.note, 'bbox slightly off');
  // Target (geometry/category reference) is unchanged across the transition.
  assert.deepStrictEqual(reviewed.target, started.target);
});

// --- Architecture coupling guard (mirror of the QA-engine domain-purity guard) ---

test('review domain imports only domain siblings — no application/infra/HTTP/SQLite', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const files = ['ReviewItem.js', 'ReviewVocabulary.js'];
  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, '../../src/domain/review/', file), 'utf8');
    const requires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    for (const dep of requires) {
      assert.ok(dep.startsWith('.'), `${file} must only require relative domain modules, got ${dep}`);
    }
    assert.ok(
      !/application|infrastructure|repositories|persistence|sqlite|express|http/i.test(requires.join(',')),
      `${file} must not depend on application/infrastructure/HTTP/SQLite`
    );
  }
});

