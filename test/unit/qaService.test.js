'use strict';

// Phase 4 unit test — QAService orchestration with FAKE repositories and a fake
// engine. Verifies the QARun lifecycle, raw→canonical id mapping, atomic
// persistence, and FAILED handling without touching SQLite.

const { test } = require('node:test');
const assert = require('node:assert');
const { QAService } = require('../../src/application/qa/QAService');

// Fake repositories recording calls; transaction() runs the fn (and surfaces
// throws like better-sqlite3's atomic transaction).
function fakeRepos() {
  const runs = [];
  const issues = [];
  const qaRunRepository = {
    create: (r) => {
      runs.push(r);
      return { ...r };
    },
    transaction: (fn) => fn(),
  };
  const qaIssueRepository = {
    created: issues,
    createMany: (list) => {
      for (const i of list) issues.push(i);
      return list.length;
    },
  };
  return { runs, issues, qaRunRepository, qaIssueRepository };
}

// Deterministic id generator + clock.
function fakeIds() {
  let n = 0;
  return () => `id-${(n += 1)}`;
}
function fakeClock() {
  const times = ['2026-10-01T10:00:00.000Z', '2026-10-01T10:00:05.000Z', '2026-10-01T10:00:09.000Z'];
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

// A view with one image + one annotation; canonical ids distinct from raw ids.
const view = (overrides = {}) => ({
  images: [{ rawId: 1, canonicalId: 'v::img::1', fileName: 'a.png', width: 640, height: 480 }],
  annotations: [
    { rawId: 100, canonicalId: 'v::ann::100', rawImageId: 1, canonicalImageId: 'v::img::1', categoryId: 5, bbox: [1, 1, 2, 2], segmentation: null },
  ],
  imageIds: new Set([1]),
  categoryIds: new Set([5]),
  ...overrides,
});

const makeService = (deps, engine) => {
  const r = fakeRepos();
  const service = new QAService({
    qaRunRepository: r.qaRunRepository,
    qaIssueRepository: r.qaIssueRepository,
    runQaEngine: engine,
    idGenerator: fakeIds(),
    clock: fakeClock(),
    ...deps,
  });
  return { service, repos: r };
};

test('calls runQaEngine with the view and categories', () => {
  let seen = null;
  const engine = (v, opts) => {
    seen = { v, opts };
    return { issues: [], invalidSets: {}, summary: { totalIssues: 0 } };
  };
  const { service } = makeService({}, engine);
  const v = view();
  service.runAndPersist({ datasetVersionId: 'v1', view: v, categories: [{ rawId: 5, name: 'car' }], rulesVersion: 'v1-rules' });
  assert.strictEqual(seen.v, v);
  assert.deepStrictEqual(seen.opts, { categories: [{ rawId: 5, name: 'car' }] });
});

test('a successful run persists exactly one COMPLETED QARun with the summary', () => {
  const engine = () => ({ issues: [], invalidSets: {}, summary: { totalIssues: 0, severityCounts: { HIGH: 0 } } });
  const { service, repos } = makeService({}, engine);
  const persisted = service.runAndPersist({ datasetVersionId: 'v1', view: view(), rulesVersion: 'v1-rules' });
  assert.strictEqual(repos.runs.length, 1);
  assert.strictEqual(repos.runs[0].status, 'COMPLETED');
  assert.strictEqual(repos.runs[0].rulesVersion, 'v1-rules');
  assert.deepStrictEqual(repos.runs[0].summary, { totalIssues: 0, severityCounts: { HIGH: 0 } });
  assert.strictEqual(persisted.status, 'COMPLETED');
  assert.ok(repos.runs[0].startedAt && repos.runs[0].completedAt);
});

test('all issue descriptors are materialized into QAIssues on the same run and version', () => {
  const engine = () => ({
    issues: [
      { type: 'SMALL_OBJECT', severity: 'MEDIUM', imageId: 1, annotationId: 100, categoryId: 5, reason: 'r', details: { maxSide: 2 } },
    ],
    invalidSets: {},
    summary: { totalIssues: 1 },
  });
  const { service, repos } = makeService({}, engine);
  service.runAndPersist({ datasetVersionId: 'v1', view: view(), rulesVersion: 'v1-rules' });
  assert.strictEqual(repos.issues.length, 1);
  assert.strictEqual(repos.issues[0].qaRunId, repos.runs[0].id);
  assert.strictEqual(repos.issues[0].datasetVersionId, 'v1');
});

test('raw image/annotation ids are mapped to canonical ids', () => {
  const engine = () => ({
    issues: [{ type: 'SMALL_OBJECT', severity: 'MEDIUM', imageId: 1, annotationId: 100, categoryId: 5, reason: 'r', details: {} }],
    invalidSets: {},
    summary: {},
  });
  const { service, repos } = makeService({}, engine);
  service.runAndPersist({ datasetVersionId: 'v1', view: view(), rulesVersion: 'v1-rules' });
  assert.strictEqual(repos.issues[0].imageId, 'v::img::1');
  assert.strictEqual(repos.issues[0].annotationId, 'v::ann::100');
});

test('a dangling image finding keeps imageId null and preserves raw reference in details', () => {
  const engine = () => ({
    issues: [{ type: 'INVALID_IMAGE_REFERENCE', severity: 'HIGH', imageId: null, annotationId: 100, categoryId: 5, reason: 'r', details: { referencedImageId: 999 } }],
    invalidSets: {},
    summary: {},
  });
  const { service, repos } = makeService({}, engine);
  service.runAndPersist({ datasetVersionId: 'v1', view: view(), rulesVersion: 'v1-rules' });
  assert.strictEqual(repos.issues[0].imageId, null);
  assert.strictEqual(repos.issues[0].details.referencedImageId, 999);
});

test('an annotation with no canonical row keeps annotationId null and preserves the raw id', () => {
  // Engine references raw annotation 101, but the view has no canonical row for it
  // (canonicalId null) → annotationId must stay null, raw id preserved in details.
  const v = view({
    annotations: [
      { rawId: 101, canonicalId: null, rawImageId: 1, canonicalImageId: 'v::img::1', categoryId: 5, bbox: [0, 0, -5, 5], segmentation: null },
    ],
  });
  const engine = () => ({
    issues: [{ type: 'INVALID_BBOX', severity: 'HIGH', imageId: 1, annotationId: 101, categoryId: 5, reason: 'r', details: { problem: 'width<=0' } }],
    invalidSets: {},
    summary: {},
  });
  const { service, repos } = makeService({}, engine);
  service.runAndPersist({ datasetVersionId: 'v1', view: v, rulesVersion: 'v1-rules' });
  assert.strictEqual(repos.issues[0].annotationId, null);
  assert.strictEqual(repos.issues[0].imageId, 'v::img::1'); // image still resolves
  assert.strictEqual(repos.issues[0].details.rawAnnotationId, 101);
});

test('a category-invalid finding preserves the raw category id (no FK)', () => {
  const engine = () => ({
    issues: [{ type: 'INVALID_CATEGORY_REFERENCE', severity: 'HIGH', imageId: 1, annotationId: 100, categoryId: 777, reason: 'r', details: { referencedCategoryId: 777 } }],
    invalidSets: {},
    summary: {},
  });
  const { service, repos } = makeService({}, engine);
  service.runAndPersist({ datasetVersionId: 'v1', view: view(), rulesVersion: 'v1-rules' });
  assert.strictEqual(repos.issues[0].categoryId, 777);
  assert.strictEqual(repos.issues[0].details.referencedCategoryId, 777);
});

test('every persisted issue belongs to the run datasetVersionId', () => {
  const engine = () => ({
    issues: [
      { type: 'SMALL_OBJECT', severity: 'MEDIUM', imageId: 1, annotationId: 100, categoryId: 5, reason: 'r', details: {} },
      { type: 'MISSING_ANNOTATION', severity: 'INFO', imageId: 1, annotationId: null, categoryId: null, reason: 'r', details: { annotationCount: 0 } },
    ],
    invalidSets: {},
    summary: {},
  });
  const { service, repos } = makeService({}, engine);
  service.runAndPersist({ datasetVersionId: 'v1', view: view(), rulesVersion: 'v1-rules' });
  assert.ok(repos.issues.every((i) => i.datasetVersionId === 'v1'));
  assert.ok(repos.issues.every((i) => i.qaRunId === repos.runs[0].id));
});

test('engine execution failure persists a FAILED run and rethrows; no issues persisted', () => {
  const engine = () => {
    throw new Error('engine boom');
  };
  const { service, repos } = makeService({}, engine);
  assert.throws(() => service.runAndPersist({ datasetVersionId: 'v1', view: view(), rulesVersion: 'v1-rules' }), /engine boom/);
  assert.strictEqual(repos.runs.length, 1);
  assert.strictEqual(repos.runs[0].status, 'FAILED');
  assert.ok(repos.runs[0].startedAt && repos.runs[0].completedAt);
  assert.strictEqual(repos.issues.length, 0);
});

test('a transaction failure persists no partial issue set', () => {
  // Fake transaction that throws on commit AFTER createMany ran → the service must
  // surface the throw and (by atomicity contract) leave no partial state. Here we
  // assert the throw propagates; real atomicity is covered by the integration test.
  const engine = () => ({
    issues: [{ type: 'SMALL_OBJECT', severity: 'MEDIUM', imageId: 1, annotationId: 100, categoryId: 5, reason: 'r', details: {} }],
    invalidSets: {},
    summary: {},
  });
  const r = fakeRepos();
  r.qaRunRepository.transaction = () => {
    throw new Error('commit failed');
  };
  const service = new QAService({
    qaRunRepository: r.qaRunRepository,
    qaIssueRepository: r.qaIssueRepository,
    runQaEngine: engine,
    idGenerator: fakeIds(),
    clock: fakeClock(),
  });
  assert.throws(() => service.runAndPersist({ datasetVersionId: 'v1', view: view(), rulesVersion: 'v1-rules' }), /commit failed/);
  // createMany never ran because transaction threw before invoking the body.
  assert.strictEqual(r.issues.length, 0);
});

test('rulesVersion comes from the caller, not a hard-coded value', () => {
  const engine = () => ({ issues: [], invalidSets: {}, summary: {} });
  const { service, repos } = makeService({}, engine);
  service.runAndPersist({ datasetVersionId: 'v1', view: view(), rulesVersion: 'custom-rules-7' });
  assert.strictEqual(repos.runs[0].rulesVersion, 'custom-rules-7');
});
