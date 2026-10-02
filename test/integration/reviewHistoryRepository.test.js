'use strict';

// Phase 5.2 integration test — ReviewHistoryRepository over a migrated SQLite db.
// FK parents (dataset → version → review_item) are seeded with direct SQL in
// test setup because the ReviewItem repository does not exist yet (Phase 5.3).

const { test } = require('node:test');
const assert = require('node:assert');
const { memDb } = require('../helpers/fixtures');
const { ReviewHistoryRepository } = require('../../src/infrastructure/repositories/ReviewHistoryRepository');
const { createReviewHistory } = require('../../src/domain/review/ReviewHistory');

const TS = (n) => `2026-01-01T00:00:0${n}.000Z`;

// Seed dataset + version + one review_item so review_history FKs resolve.
function seed(db, { versionId = 'v1', reviewItemId = 'ri-1' } = {}) {
  db.prepare('INSERT INTO datasets (id, name, created_at, updated_at) VALUES (?,?,?,?)').run(
    'ds1', 'Cars', TS(0), TS(0)
  );
  db.prepare(
    'INSERT INTO dataset_versions (id, dataset_id, version_number, status, created_at) VALUES (?,?,?,?,?)'
  ).run(versionId, 'ds1', 1, 'READY', TS(0));
  db.prepare(
    `INSERT INTO review_items
       (id, dataset_version_id, target_type, source, status, review_round, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(reviewItemId, versionId, 'IMAGE', 'QA', 'REVIEWED', 1, TS(0), TS(0));
}

function repoWithSeed(opts) {
  const db = memDb();
  seed(db, opts);
  return { db, repo: new ReviewHistoryRepository(db) };
}

const hist = (over = {}) =>
  createReviewHistory({
    id: 'rh-1', reviewItemId: 'ri-1', datasetVersionId: 'v1', reviewRound: 1,
    status: 'REVIEWED', decision: 'ACCEPT', note: null,
    reviewerId: 'u1', reviewerName: 'Alice', timestamp: TS(1), ...over,
  });

test('create then findById round-trips all columns', () => {
  const { repo } = repoWithSeed();
  const saved = repo.create(hist({ note: 'ok' }));
  assert.strictEqual(saved.id, 'rh-1');
  assert.strictEqual(saved.review_item_id, 'ri-1');
  assert.strictEqual(saved.dataset_version_id, 'v1');
  assert.strictEqual(saved.review_round, 1);
  assert.strictEqual(saved.status, 'REVIEWED');
  assert.strictEqual(saved.decision, 'ACCEPT');
  assert.strictEqual(saved.note, 'ok');
  assert.strictEqual(saved.reviewer_id, 'u1');
  assert.strictEqual(saved.reviewer_name, 'Alice');
  assert.strictEqual(saved.timestamp, TS(1));
  assert.deepStrictEqual(repo.findById('rh-1'), saved);
  assert.strictEqual(repo.findById('missing'), null);
});

test('findByReviewItem ordered by review_round, timestamp, id', () => {
  const { repo } = repoWithSeed();
  // Insert out of order.
  repo.create(hist({ id: 'b', reviewRound: 2, timestamp: TS(1) }));
  repo.create(hist({ id: 'a', reviewRound: 1, timestamp: TS(5) }));
  repo.create(hist({ id: 'c', reviewRound: 2, timestamp: TS(1) }));
  const rows = repo.findByReviewItem('ri-1').map((r) => r.id);
  // round 1 first; within round 2 same timestamp -> id asc (b before c).
  assert.deepStrictEqual(rows, ['a', 'b', 'c']);
});

test('findByVersion ordered by timestamp, id', () => {
  const { db, repo } = repoWithSeed();
  // second review item in same version
  db.prepare(
    `INSERT INTO review_items (id, dataset_version_id, target_type, source, status, review_round, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run('ri-2', 'v1', 'IMAGE', 'QA', 'REVIEWED', 1, TS(0), TS(0));
  repo.create(hist({ id: 'x', reviewItemId: 'ri-1', timestamp: TS(5) }));
  repo.create(hist({ id: 'y', reviewItemId: 'ri-2', timestamp: TS(2) }));
  repo.create(hist({ id: 'z', reviewItemId: 'ri-1', timestamp: TS(2) }));
  const rows = repo.findByVersion('v1').map((r) => r.id);
  // timestamp asc; TS(2) tie -> id asc (y before z); then x at TS(5).
  assert.deepStrictEqual(rows, ['y', 'z', 'x']);
});

test('multiple history rows coexist (append-only, no overwrite)', () => {
  const { repo } = repoWithSeed();
  repo.create(hist({ id: 'h1', timestamp: TS(1) }));
  repo.create(hist({ id: 'h2', timestamp: TS(2) }));
  assert.strictEqual(repo.findByReviewItem('ri-1').length, 2);
});

test('multiple rows for same reviewItem + same round allowed', () => {
  const { repo } = repoWithSeed();
  repo.create(hist({ id: 'h1', reviewRound: 1, timestamp: TS(1) }));
  repo.create(hist({ id: 'h2', reviewRound: 1, timestamp: TS(2) }));
  const rows = repo.findByReviewItem('ri-1');
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map((r) => r.review_round), [1, 1]);
});

test('nullable optional fields round-trip', () => {
  const { repo } = repoWithSeed();
  const saved = repo.create(
    hist({ status: 'IN_REVIEW', decision: null, note: null, reviewerId: null, reviewerName: null })
  );
  assert.strictEqual(saved.decision, null);
  assert.strictEqual(saved.note, null);
  assert.strictEqual(saved.reviewer_id, null);
  assert.strictEqual(saved.reviewer_name, null);
});

test('FK rejects a missing review_item_id', () => {
  const { repo } = repoWithSeed();
  assert.throws(() => repo.create(hist({ reviewItemId: 'nope' })), /FOREIGN KEY/i);
});

test('FK rejects a missing dataset_version_id', () => {
  const { repo } = repoWithSeed();
  assert.throws(() => repo.create(hist({ datasetVersionId: 'nope' })), /FOREIGN KEY/i);
});

test('append-only API exposes no update or delete', () => {
  const { repo } = repoWithSeed();
  assert.strictEqual(typeof repo.update, 'undefined');
  assert.strictEqual(typeof repo.delete, 'undefined');
  assert.strictEqual(typeof repo.remove, 'undefined');
  assert.strictEqual(typeof repo.upsert, 'undefined');
});

test('create does not upsert: duplicate id throws, original preserved', () => {
  const { repo } = repoWithSeed();
  repo.create(hist({ id: 'dup', note: 'first' }));
  assert.throws(() => repo.create(hist({ id: 'dup', note: 'second' })), /UNIQUE|PRIMARY/i);
  assert.strictEqual(repo.findById('dup').note, 'first');
});
