'use strict';

// Phase 4 final step — import → QA integration (v2.md §12, §28). Drives the REAL
// import flow through buildServices and asserts that a successful import runs QA
// automatically, AFTER the import transaction commits, in its own transaction,
// with failure fully isolated from the already-READY version.

const { test } = require('node:test');
const assert = require('node:assert');
const { memDb, tmpDir, writeDataset, PNG_1x1 } = require('../helpers/fixtures');
const { buildServices } = require('../../src/composition');
const { ImportDatasetService } = require('../../src/application/import/ImportDatasetService');
const { QAService } = require('../../src/application/qa/QAService');
const { buildQADatasetView } = require('../../src/application/import/QADatasetViewBuilder');
const { runQaEngine } = require('../../src/domain/qa/runQaEngine');
const { DatasetRepository } = require('../../src/infrastructure/repositories/DatasetRepository');
const { DatasetVersionRepository } = require('../../src/infrastructure/repositories/DatasetVersionRepository');
const { ImageRepository } = require('../../src/infrastructure/repositories/ImageRepository');
const { AnnotationRepository } = require('../../src/infrastructure/repositories/AnnotationRepository');
const { QaRunRepository } = require('../../src/infrastructure/repositories/QaRunRepository');
const { QaIssueRepository } = require('../../src/infrastructure/repositories/QaIssueRepository');
const { LocalFileStorage } = require('../../src/infrastructure/filesystem/LocalFileStorage');
const { SourceReader } = require('../../src/infrastructure/filesystem/SourceReader');
const { parseCoco } = require('../../src/infrastructure/coco/CocoParser');
const { normalize } = require('../../src/infrastructure/coco/CocoNormalizer');
const { probeImageDimensions } = require('../../src/infrastructure/filesystem/imageProbe');
const { datasetFingerprint, sha256Hex } = require('../../src/infrastructure/fingerprint');
const { validateReferences } = require('../../src/domain/dataset/DatasetValidator');

// Wire a real ImportDatasetService over real repos/infra, but with an overridable
// QAService (test seams for QA engine/persistence failure). Mirrors composition.
function wiredServices({ qaServiceOverride, qaRunRepository, qaIssueRepository } = {}) {
  const db = memDb();
  const dataDir = tmpDir('dsqa-data-');
  const datasetRepository = new DatasetRepository(db);
  const datasetVersionRepository = new DatasetVersionRepository(db);
  const imageRepository = new ImageRepository(db);
  const annotationRepository = new AnnotationRepository(db);
  const runRepo = qaRunRepository || new QaRunRepository(db);
  const issueRepo = qaIssueRepository || new QaIssueRepository(db);
  const storage = new LocalFileStorage(dataDir);

  const qaService =
    qaServiceOverride ||
    new QAService({
      qaRunRepository: runRepo,
      qaIssueRepository: issueRepo,
      runQaEngine,
      idGenerator: () => require('crypto').randomUUID(),
      clock: () => new Date().toISOString(),
    });

  const importService = new ImportDatasetService({
    datasetRepository,
    datasetVersionRepository,
    imageRepository,
    annotationRepository,
    storage,
    cocoAdapter: { parse: parseCoco, normalize },
    validateReferences,
    imageProbe: probeImageDimensions,
    fingerprinter: { datasetFingerprint, sha256Hex },
    qaService,
    buildQADatasetView,
    rulesVersion: QA_RULES_VERSION,
  });

  const runImport = (datasetId, srcDir, opts = {}) =>
    importService.execute({ datasetId, source: new SourceReader(srcDir), ...opts });
  return { db, dataDir, importService, runImport };
}

const QA_RULES_VERSION = 'v1'; // mirrors the composition constant

function coco(overrides = {}) {
  return {
    images: [{ id: 1, file_name: 'a.png', width: 1, height: 1 }],
    categories: [{ id: 1, name: 'car' }],
    annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1] }],
    ...overrides,
  };
}

function services() {
  const db = memDb();
  const dataDir = tmpDir('dsqa-data-');
  const built = buildServices({ db, dataDir });
  const runImport = (datasetId, srcDir, opts = {}) =>
    built.importService.execute({ datasetId, source: built.sourceReaderFactory(srcDir), ...opts });
  return { db, dataDir, ...built, runImport };
}

const runsFor = (db, versionId) =>
  db.prepare('SELECT * FROM qa_runs WHERE dataset_version_id = ? ORDER BY started_at, id').all(versionId);
const issuesFor = (db, versionId) =>
  db.prepare('SELECT * FROM qa_issues WHERE dataset_version_id = ? ORDER BY created_at, id').all(versionId);

// TEST 1 — a successful import automatically runs QA to COMPLETED.
test('a successful import automatically runs exactly one COMPLETED QA run with a summary', () => {
  const s = services();
  // One image, one 1x1 bbox → SMALL_OBJECT (side < 20) is expected.
  const src = writeDataset(tmpDir('dsqa-src-'), { coco: coco(), images: { 'a.png': PNG_1x1 } });

  const version = s.runImport('ds1', src, { datasetName: 'Cars' });
  assert.strictEqual(version.status, 'READY');

  const runs = runsFor(s.db, version.id);
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].status, 'COMPLETED');
  assert.ok(runs[0].started_at && runs[0].completed_at);
  assert.ok(runs[0].summary_json, 'summary_json present');
  const summary = JSON.parse(runs[0].summary_json);
  assert.ok(summary.totalIssues >= 1);

  const issues = issuesFor(s.db, version.id);
  assert.ok(issues.some((i) => i.type === 'SMALL_OBJECT'));
  assert.ok(issues.every((i) => i.qa_run_id === runs[0].id));
});

// TEST 2 — QA receives real raw category metadata (CLASS_IMBALANCE).
test('QA uses real raw category metadata — CLASS_IMBALANCE with raw categoryId and configured rulesVersion', () => {
  const s = services();
  // 3 annotations in category 7, 1 in category 8 → category 7 is 75% (> 50 → HIGH).
  const src = writeDataset(tmpDir('dsqa-src-'), {
    coco: coco({
      categories: [{ id: 7, name: 'car' }, { id: 8, name: 'truck' }],
      annotations: [
        { id: 1, image_id: 1, category_id: 7, bbox: [0, 0, 1, 1] },
        { id: 2, image_id: 1, category_id: 7, bbox: [0, 0, 1, 1] },
        { id: 3, image_id: 1, category_id: 7, bbox: [0, 0, 1, 1] },
        { id: 4, image_id: 1, category_id: 8, bbox: [0, 0, 1, 1] },
      ],
    }),
    images: { 'a.png': PNG_1x1 },
  });

  const version = s.runImport('ds1', src);
  assert.strictEqual(version.status, 'READY');

  const runs = runsFor(s.db, version.id);
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].rules_version, QA_RULES_VERSION);

  const imbalance = issuesFor(s.db, version.id).find((i) => i.type === 'CLASS_IMBALANCE');
  assert.ok(imbalance, 'CLASS_IMBALANCE issue persisted');
  assert.strictEqual(imbalance.category_id, 7); // raw winning category id preserved
  const details = JSON.parse(imbalance.details_json);
  assert.strictEqual(details.largestClass, 'car');
  assert.ok(details.largestClassPercentage > 50);
});

// TEST 3 — canonical id mapping: findings on valid records carry real DB ids.
test('persisted issue image_id/annotation_id equal the real canonical DB ids', () => {
  const s = services();
  const src = writeDataset(tmpDir('dsqa-src-'), { coco: coco(), images: { 'a.png': PNG_1x1 } });

  const version = s.runImport('ds1', src);
  const small = issuesFor(s.db, version.id).find((i) => i.type === 'SMALL_OBJECT');
  assert.ok(small);
  assert.strictEqual(small.image_id, `${version.id}::img::1`);
  assert.strictEqual(small.annotation_id, `${version.id}::ann::1`);
  // The referenced rows actually exist (FK satisfied, no fabricated rows).
  assert.ok(s.db.prepare('SELECT 1 FROM images WHERE id = ?').get(small.image_id));
  assert.ok(s.db.prepare('SELECT 1 FROM annotations WHERE id = ?').get(small.annotation_id));
});

// TEST 4 — dangling / excluded records: READY, COMPLETED, nullable FKs stay safe,
// raw ids preserved in details, no fabricated canonical rows.
test('dangling/excluded records: READY + COMPLETED run with FK-safe null ids and raw ids in details', () => {
  const s = services();
  const src = writeDataset(tmpDir('dsqa-src-'), {
    coco: coco({
      categories: [{ id: 1, name: 'car' }],
      annotations: [
        { id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1] }, // valid
        { id: 2, image_id: 999, category_id: 1, bbox: [0, 0, 1, 1] }, // dangling image
        { id: 3, image_id: 1, category_id: 1, bbox: [0, 0, -5, 1] }, // unbuildable bbox (no seg)
        { id: 4, image_id: 1, category_id: 777, bbox: [0, 0, 1, 1] }, // dangling category
      ],
    }),
    images: { 'a.png': PNG_1x1 },
  });

  const version = s.runImport('ds1', src);
  assert.strictEqual(version.status, 'READY');

  const runs = runsFor(s.db, version.id);
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].status, 'COMPLETED');

  const issues = issuesFor(s.db, version.id);

  // Dangling image: image_id null (FK-safe), raw referenced id in details.
  const imgRef = issues.find((i) => i.type === 'INVALID_IMAGE_REFERENCE');
  assert.ok(imgRef);
  assert.strictEqual(imgRef.image_id, null);
  assert.strictEqual(imgRef.annotation_id, null); // excluded record → no canonical row
  const imgRefDetails = JSON.parse(imgRef.details_json);
  assert.strictEqual(imgRefDetails.referencedImageId, 999);
  assert.strictEqual(imgRefDetails.rawAnnotationId, 2);

  // Unbuildable bbox (no segmentation): excluded → annotation_id null, raw id kept.
  const badBbox = issues.find((i) => i.type === 'INVALID_BBOX');
  assert.ok(badBbox);
  assert.strictEqual(badBbox.annotation_id, null);
  assert.strictEqual(JSON.parse(badBbox.details_json).rawAnnotationId, 3);

  // Dangling category: annotation persists → canonical ids resolve; raw category kept.
  const catRef = issues.find((i) => i.type === 'INVALID_CATEGORY_REFERENCE');
  assert.ok(catRef);
  assert.strictEqual(catRef.annotation_id, `${version.id}::ann::4`);
  assert.strictEqual(catRef.category_id, 777);

  // No fabricated canonical rows: only the two normalizable annotations persist.
  const annRows = s.db
    .prepare('SELECT id FROM annotations WHERE dataset_version_id = ? ORDER BY id')
    .all(version.id)
    .map((r) => r.id);
  assert.deepStrictEqual(annRows, [`${version.id}::ann::1`, `${version.id}::ann::4`]);
  assert.strictEqual(s.db.prepare('SELECT COUNT(*) AS n FROM images WHERE dataset_version_id = ?').get(version.id).n, 1);
});

// TEST 5 — QA engine failure isolation. A failing engine → QAService persists a
// FAILED run and rethrows; import must still return the READY version and keep
// all imported rows.
test('QA engine failure: import stays READY, a FAILED run is persisted, no import rows rolled back', () => {
  const db = memDb();
  const dataDir = tmpDir('dsqa-data-');
  const qaRunRepository = new QaRunRepository(db);
  const qaIssueRepository = new QaIssueRepository(db);
  // Real QAService, but engine throws → exercises the real FAILED-persistence path.
  const qaService = new QAService({
    qaRunRepository,
    qaIssueRepository,
    runQaEngine: () => {
      throw new Error('engine boom');
    },
    idGenerator: () => require('crypto').randomUUID(),
    clock: () => new Date().toISOString(),
  });
  const importService = new ImportDatasetService({
    datasetRepository: new DatasetRepository(db),
    datasetVersionRepository: new DatasetVersionRepository(db),
    imageRepository: new ImageRepository(db),
    annotationRepository: new AnnotationRepository(db),
    storage: new LocalFileStorage(dataDir),
    cocoAdapter: { parse: parseCoco, normalize },
    validateReferences,
    imageProbe: probeImageDimensions,
    fingerprinter: { datasetFingerprint, sha256Hex },
    qaService,
    buildQADatasetView,
    rulesVersion: QA_RULES_VERSION,
  });

  const src = writeDataset(tmpDir('dsqa-src-'), { coco: coco(), images: { 'a.png': PNG_1x1 } });
  const version = importService.execute({ datasetId: 'ds1', source: new SourceReader(src) });

  assert.strictEqual(version.status, 'READY'); // did not throw, still READY
  assert.strictEqual(db.prepare('SELECT status FROM dataset_versions WHERE id = ?').get(version.id).status, 'READY');

  const runs = runsFor(db, version.id);
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].status, 'FAILED');
  assert.strictEqual(issuesFor(db, version.id).length, 0);

  // Import rows intact.
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM images WHERE dataset_version_id = ?').get(version.id).n, 1);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM annotations WHERE dataset_version_id = ?').get(version.id).n, 1);
});

// TEST 6 — QA persistence failure isolation. runAndPersist throws during COMPLETED
// persistence → QA transaction rolls back; import version remains READY with no
// partial QA state.
test('QA persistence failure: import stays READY, QA transaction rolls back, no partial QARun/QAIssue', () => {
  const db = memDb();
  const dataDir = tmpDir('dsqa-data-');
  const realRunRepo = new QaRunRepository(db);
  const realIssueRepo = new QaIssueRepository(db);
  // Make the atomic COMPLETED-run+issues transaction throw AFTER the body would
  // run, so (by better-sqlite3 atomicity) nothing is committed.
  const failingRunRepo = Object.create(QaRunRepository.prototype);
  failingRunRepo.db = db;
  failingRunRepo.create = (r) => realRunRepo.create(r);
  failingRunRepo.findById = (id) => realRunRepo.findById(id);
  failingRunRepo.transaction = () => {
    throw new Error('commit failed');
  };

  const qaService = new QAService({
    qaRunRepository: failingRunRepo,
    qaIssueRepository: realIssueRepo,
    runQaEngine,
    idGenerator: () => require('crypto').randomUUID(),
    clock: () => new Date().toISOString(),
  });
  const importService = new ImportDatasetService({
    datasetRepository: new DatasetRepository(db),
    datasetVersionRepository: new DatasetVersionRepository(db),
    imageRepository: new ImageRepository(db),
    annotationRepository: new AnnotationRepository(db),
    storage: new LocalFileStorage(dataDir),
    cocoAdapter: { parse: parseCoco, normalize },
    validateReferences,
    imageProbe: probeImageDimensions,
    fingerprinter: { datasetFingerprint, sha256Hex },
    qaService,
    buildQADatasetView,
    rulesVersion: QA_RULES_VERSION,
  });

  const src = writeDataset(tmpDir('dsqa-src-'), { coco: coco(), images: { 'a.png': PNG_1x1 } });
  const version = importService.execute({ datasetId: 'ds1', source: new SourceReader(src) });

  assert.strictEqual(version.status, 'READY');
  // The transaction threw before committing anything → no run, no issues.
  assert.strictEqual(runsFor(db, version.id).length, 0);
  assert.strictEqual(issuesFor(db, version.id).length, 0);
});

// TEST 7 — exactly one automatic QA execution per execute() call.
test('one execute() call creates exactly one QARun (QA runs once)', () => {
  let calls = 0;
  const countingQa = {
    runAndPersist: () => {
      calls += 1;
      return { id: 'r', status: 'COMPLETED' };
    },
  };
  const s = wiredServices({ qaServiceOverride: countingQa });
  const src = writeDataset(tmpDir('dsqa-src-'), { coco: coco(), images: { 'a.png': PNG_1x1 } });
  const version = s.runImport('ds1', src);
  assert.strictEqual(version.status, 'READY');
  assert.strictEqual(calls, 1);
});

// Guard — import still works when no QA deps are injected (backward compatible).
test('import without injected QA deps still produces a READY version and no QA runs', () => {
  const db = memDb();
  const dataDir = tmpDir('dsqa-data-');
  const importService = new ImportDatasetService({
    datasetRepository: new DatasetRepository(db),
    datasetVersionRepository: new DatasetVersionRepository(db),
    imageRepository: new ImageRepository(db),
    annotationRepository: new AnnotationRepository(db),
    storage: new LocalFileStorage(dataDir),
    cocoAdapter: { parse: parseCoco, normalize },
    validateReferences,
    imageProbe: probeImageDimensions,
    fingerprinter: { datasetFingerprint, sha256Hex },
    // no qaService / buildQADatasetView / rulesVersion
  });
  const src = writeDataset(tmpDir('dsqa-src-'), { coco: coco(), images: { 'a.png': PNG_1x1 } });
  const version = importService.execute({ datasetId: 'ds1', source: new SourceReader(src) });
  assert.strictEqual(version.status, 'READY');
  assert.strictEqual(runsFor(db, version.id).length, 0);
});


