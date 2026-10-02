'use strict';

// Phase 4 integration test — QaRun/QaIssue repositories against a real
// (in-memory) migrated SQLite schema, including FK enforcement and atomic
// rollback (v2.md §14.3 qa_runs/qa_issues, §14.4).

const { test } = require('node:test');
const assert = require('node:assert');
const { memDb } = require('../helpers/fixtures');
const { DatasetRepository } = require('../../src/infrastructure/repositories/DatasetRepository');
const { DatasetVersionRepository } = require('../../src/infrastructure/repositories/DatasetVersionRepository');
const { ImageRepository } = require('../../src/infrastructure/repositories/ImageRepository');
const { AnnotationRepository } = require('../../src/infrastructure/repositories/AnnotationRepository');
const { QaRunRepository } = require('../../src/infrastructure/repositories/QaRunRepository');
const { QaIssueRepository } = require('../../src/infrastructure/repositories/QaIssueRepository');

const T0 = '2026-10-01T10:00:00.000Z';
const T1 = '2026-10-01T10:00:05.000Z';

// Seed a READY version with one image + one annotation so FK targets exist.
function seed(db) {
  const now = T0;
  new DatasetRepository(db).upsert({ id: 'ds1', name: 'ds1', description: null, createdAt: now, updatedAt: now });
  new DatasetVersionRepository(db).create({
    id: 'v1', datasetId: 'ds1', versionNumber: 1, parentVersionId: null,
    status: 'READY', fingerprint: 'fp', createdAt: now, createdBy: null,
  });
  new ImageRepository(db).create({
    id: 'v1::img::1', datasetVersionId: 'v1', fileName: 'a.png', relativePath: 'images/a.png',
    width: 10, height: 20, fingerprint: 'h',
  });
  new AnnotationRepository(db).create({
    id: 'v1::ann::1', datasetVersionId: 'v1', imageId: 'v1::img::1', categoryId: 5, categoryName: 'car',
    geometryType: 'BBOX', bboxJson: '{}', segmentationJson: null, attributesJson: '{}', metadataJson: '{}',
  });
}

const run = (overrides = {}) => ({
  id: 'run-1', datasetVersionId: 'v1', rulesVersion: 'v1-rules',
  status: 'COMPLETED', startedAt: T0, completedAt: T1, summary: { totalIssues: 0 }, ...overrides,
});
const issue = (overrides = {}) => ({
  id: 'issue-1', qaRunId: 'run-1', datasetVersionId: 'v1', type: 'SMALL_OBJECT', severity: 'MEDIUM',
  imageId: 'v1::img::1', annotationId: 'v1::ann::1', categoryId: 5, reason: 'r',
  details: { bbox: [1, 2, 3, 4] }, createdAt: T1, ...overrides,
});

// --- QARun ---

test('QARun create / findById round-trips, summary serialized', () => {
  const db = memDb();
  seed(db);
  const runs = new QaRunRepository(db);
  const created = runs.create(run({ summary: { totalIssues: 3, severityCounts: { HIGH: 1 } } }));
  assert.strictEqual(created.id, 'run-1');
  assert.strictEqual(created.status, 'COMPLETED');
  assert.strictEqual(created.rules_version, 'v1-rules');
  assert.deepStrictEqual(JSON.parse(created.summary_json), { totalIssues: 3, severityCounts: { HIGH: 1 } });
});

test('QARun findByVersion returns runs for a version in deterministic order', () => {
  const db = memDb();
  seed(db);
  const runs = new QaRunRepository(db);
  runs.create(run({ id: 'run-b', startedAt: T1 }));
  runs.create(run({ id: 'run-a', startedAt: T0 }));
  assert.deepStrictEqual(runs.findByVersion('v1').map((r) => r.id), ['run-a', 'run-b']);
});

test('QARun with a non-existent dataset_version is rejected by the FK', () => {
  const db = memDb();
  seed(db);
  assert.throws(() => new QaRunRepository(db).create(run({ datasetVersionId: 'nope' })));
});

test('QARun guarded status transition: RUNNING→COMPLETED allowed, illegal rejected', () => {
  const db = memDb();
  seed(db);
  const runs = new QaRunRepository(db);
  runs.create(run({ id: 'r', status: 'RUNNING', completedAt: null, summary: null }));
  const done = runs.updateStatus('r', 'COMPLETED', { completedAt: T1, summary: { totalIssues: 1 } });
  assert.strictEqual(done.status, 'COMPLETED');
  assert.strictEqual(done.completed_at, T1);
  assert.deepStrictEqual(JSON.parse(done.summary_json), { totalIssues: 1 });
  // COMPLETED is terminal → further transition rejected.
  assert.throws(() => runs.updateStatus('r', 'RUNNING'));
});

// --- QAIssue ---

test('QAIssue create / findById round-trips, details serialized', () => {
  const db = memDb();
  seed(db);
  new QaRunRepository(db).create(run());
  const issues = new QaIssueRepository(db);
  const created = issues.create(issue({ details: { bbox: [10, 10, 5, 5], problem: 'width<=0' } }));
  assert.strictEqual(created.id, 'issue-1');
  assert.strictEqual(created.image_id, 'v1::img::1');
  assert.strictEqual(created.annotation_id, 'v1::ann::1');
  assert.strictEqual(created.category_id, 5);
  assert.deepStrictEqual(JSON.parse(created.details_json), { bbox: [10, 10, 5, 5], problem: 'width<=0' });
});

test('QAIssue createMany + findByRun / findByVersion in deterministic order', () => {
  const db = memDb();
  seed(db);
  new QaRunRepository(db).create(run());
  const issues = new QaIssueRepository(db);
  issues.createMany([
    issue({ id: 'i2', createdAt: T1 }),
    issue({ id: 'i1', createdAt: T0 }),
  ]);
  assert.deepStrictEqual(issues.findByRun('run-1').map((i) => i.id), ['i1', 'i2']);
  assert.deepStrictEqual(issues.findByVersion('v1').map((i) => i.id), ['i1', 'i2']);
});

test('QAIssue allows null image_id and annotation_id (dangling-reference findings)', () => {
  const db = memDb();
  seed(db);
  new QaRunRepository(db).create(run());
  const issues = new QaIssueRepository(db);
  const created = issues.create(
    issue({ id: 'dangling', type: 'INVALID_IMAGE_REFERENCE', severity: 'HIGH', imageId: null, annotationId: null,
      details: { referencedImageId: 999 } })
  );
  assert.strictEqual(created.image_id, null);
  assert.strictEqual(created.annotation_id, null);
  assert.deepStrictEqual(JSON.parse(created.details_json), { referencedImageId: 999 });
});

test('QAIssue with a non-existent qa_run is rejected by the FK', () => {
  const db = memDb();
  seed(db);
  assert.throws(() => new QaIssueRepository(db).create(issue({ qaRunId: 'nope' })));
});

test('QAIssue with a non-existent dataset_version is rejected by the FK', () => {
  const db = memDb();
  seed(db);
  new QaRunRepository(db).create(run());
  assert.throws(() => new QaIssueRepository(db).create(issue({ datasetVersionId: 'nope' })));
});

test('QAIssue with a non-null non-existent image_id is rejected by the FK', () => {
  const db = memDb();
  seed(db);
  new QaRunRepository(db).create(run());
  assert.throws(() => new QaIssueRepository(db).create(issue({ imageId: 'v1::img::missing' })));
});

test('QAIssue with a non-null non-existent annotation_id is rejected by the FK', () => {
  const db = memDb();
  seed(db);
  new QaRunRepository(db).create(run());
  assert.throws(() => new QaIssueRepository(db).create(issue({ annotationId: 'v1::ann::missing' })));
});

test('a failing QAIssue insert inside a transaction rolls back the whole batch', () => {
  const db = memDb();
  seed(db);
  const runs = new QaRunRepository(db);
  const issues = new QaIssueRepository(db);
  assert.throws(() =>
    runs.transaction(() => {
      runs.create(run({ id: 'run-tx' }));
      issues.createMany([
        issue({ id: 'ok', qaRunId: 'run-tx' }),
        issue({ id: 'bad', qaRunId: 'run-tx', imageId: 'v1::img::missing' }), // FK violation
      ]);
    })
  );
  // Nothing from the rolled-back transaction survives.
  assert.strictEqual(runs.findById('run-tx'), null);
  assert.strictEqual(issues.findById('ok'), null);
  assert.strictEqual(issues.findById('bad'), null);
});
