'use strict';

// Phase 2 integration test — the full import pipeline through buildServices
// (v2.md §12). Asserts atomic publish, deterministic fingerprint, isolation
// across versions, and that an incomplete dataset NEVER becomes READY.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { memDb, tmpDir, writeDataset, PNG_1x1 } = require('../helpers/fixtures');
const { buildServices } = require('../../src/composition');

// A minimal valid COCO document with one 1x1 PNG image and one bbox annotation.
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
  const { importService, sourceReaderFactory, datasetService } = buildServices({ db, dataDir });
  const runImport = (datasetId, srcDir, opts = {}) =>
    importService.execute({ datasetId, source: sourceReaderFactory(srcDir), ...opts });
  return { db, dataDir, importService, sourceReaderFactory, datasetService, runImport };
}

test('a valid import produces a READY version with published files and manifest', () => {
  const s = services();
  const src = writeDataset(tmpDir('dsqa-src-'), { coco: coco(), images: { 'a.png': PNG_1x1 } });

  const version = s.runImport('ds1', src, { datasetName: 'Cars' });

  assert.strictEqual(version.status, 'READY');
  assert.strictEqual(version.version_number, 1);
  assert.ok(version.fingerprint);

  const versionDir = path.join(s.dataDir, 'datasets', 'ds1', 'versions', 'v1');
  assert.ok(fs.existsSync(path.join(versionDir, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(versionDir, 'images', 'a.png')));
  assert.ok(fs.existsSync(path.join(versionDir, 'source', 'annotations.json')));
  // Temp staging is consumed (moved), not left behind.
  assert.ok(!fs.existsSync(path.join(s.dataDir, 'temp', `import-${version.id}`)));
});

test('the fingerprint is deterministic for identical content', () => {
  const a = services();
  const b = services();
  const srcA = writeDataset(tmpDir('dsqa-src-'), { coco: coco(), images: { 'a.png': PNG_1x1 } });
  const srcB = writeDataset(tmpDir('dsqa-src-'), { coco: coco(), images: { 'a.png': PNG_1x1 } });
  assert.strictEqual(a.runImport('ds1', srcA).fingerprint, b.runImport('ds1', srcB).fingerprint);
});

test('a missing image file blocks READY — no version, no rows, no published dir', () => {
  const s = services();
  // annotations.json references a.png, but no image file is written.
  const src = writeDataset(tmpDir('dsqa-src-'), { coco: coco(), images: {} });

  assert.throws(() => s.runImport('ds1', src), /import validation/i);

  // Validation aborts before any DB write, so the dataset is never created.
  assert.ok(!s.datasetService.listDatasets().some((d) => d.id === 'ds1'));
  assert.ok(!fs.existsSync(path.join(s.dataDir, 'datasets', 'ds1', 'versions', 'v1')));
});

test('a dimension mismatch blocks READY', () => {
  const s = services();
  const src = writeDataset(tmpDir('dsqa-src-'), {
    coco: coco({ images: [{ id: 1, file_name: 'a.png', width: 999, height: 999 }] }),
    images: { 'a.png': PNG_1x1 },
  });
  assert.throws(() => s.runImport('ds1', src), /import validation/i);
  assert.ok(!s.datasetService.listDatasets().some((d) => d.id === 'ds1'));
});

test('a traversing image file_name is rejected — no version, no files written', () => {
  const s = services();
  const evil = coco({ images: [{ id: 1, file_name: '../../evil.png', width: 1, height: 1 }] });
  const src = writeDataset(tmpDir('dsqa-src-'), { coco: evil, images: {} });

  assert.throws(() => s.runImport('ds1', src), /import validation/i);
  assert.ok(!s.datasetService.listDatasets().some((d) => d.id === 'ds1'));
  // Nothing escaped the version dir into the data root.
  assert.ok(!fs.existsSync(path.join(s.dataDir, 'evil.png')));
  assert.ok(!fs.existsSync(path.join(s.dataDir, 'datasets', 'ds1')));
});

test('a second import of the same dataset creates an isolated version 2', () => {
  const s = services();
  const src1 = writeDataset(tmpDir('dsqa-src-'), { coco: coco(), images: { 'a.png': PNG_1x1 } });
  const src2 = writeDataset(tmpDir('dsqa-src-'), { coco: coco(), images: { 'a.png': PNG_1x1 } });

  const v1 = s.runImport('ds1', src1);
  const v2 = s.runImport('ds1', src2);

  assert.strictEqual(v1.version_number, 1);
  assert.strictEqual(v2.version_number, 2);
  assert.notStrictEqual(v1.id, v2.id);
  assert.ok(fs.existsSync(path.join(s.dataDir, 'datasets', 'ds1', 'versions', 'v1')));
  assert.ok(fs.existsSync(path.join(s.dataDir, 'datasets', 'ds1', 'versions', 'v2')));
});

// --- Phase 4 Step 3B-1: record-level defects no longer crash before the QA
// boundary (Option 1). The version still becomes READY; defective records are
// held back from the canonical model for the future QA engine to report. ---

const annots = (db, versionId) =>
  db.prepare('SELECT * FROM annotations WHERE dataset_version_id = ? ORDER BY id').all(versionId);

test('a malformed bbox no longer aborts import — version is READY, record held back', () => {
  const s = services();
  const src = writeDataset(tmpDir('dsqa-src-'), {
    coco: coco({
      annotations: [
        { id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1] },
        { id: 2, image_id: 1, category_id: 1, bbox: [0, 0, -5, 1] }, // invalid, no segmentation
      ],
    }),
    images: { 'a.png': PNG_1x1 },
  });

  const version = s.runImport('ds1', src);
  assert.strictEqual(version.status, 'READY');
  // The malformed-bbox annotation is not in the canonical model (geometry stays strict).
  assert.deepStrictEqual(annots(s.db, version.id).map((a) => a.id), [`${version.id}::ann::1`]);
});

test('a dangling image reference no longer aborts import — version is READY, record held back', () => {
  const s = services();
  const src = writeDataset(tmpDir('dsqa-src-'), {
    coco: coco({
      annotations: [
        { id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1] },
        { id: 2, image_id: 999, category_id: 1, bbox: [0, 0, 1, 1] }, // dangling image
      ],
    }),
    images: { 'a.png': PNG_1x1 },
  });

  const version = s.runImport('ds1', src);
  assert.strictEqual(version.status, 'READY');
  assert.deepStrictEqual(annots(s.db, version.id).map((a) => a.id), [`${version.id}::ann::1`]);
});

test('a dangling category reference no longer aborts import — annotation still persists', () => {
  const s = services();
  const src = writeDataset(tmpDir('dsqa-src-'), {
    coco: coco({ annotations: [{ id: 1, image_id: 1, category_id: 777, bbox: [0, 0, 1, 1] }] }),
    images: { 'a.png': PNG_1x1 },
  });

  const version = s.runImport('ds1', src);
  assert.strictEqual(version.status, 'READY');
  // The annotation is otherwise valid, so it persists with its raw category id.
  const rows = annots(s.db, version.id);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].category_id, 777);
});

test('duplicate annotation ids still fail the import (fatal, not QA)', () => {
  const s = services();
  const src = writeDataset(tmpDir('dsqa-src-'), {
    coco: coco({
      annotations: [
        { id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1] },
        { id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1] },
      ],
    }),
    images: { 'a.png': PNG_1x1 },
  });
  assert.throws(() => s.runImport('ds1', src), /import validation/i);
  assert.ok(!s.datasetService.listDatasets().some((d) => d.id === 'ds1'));
});

test('a present-but-invalid declared dimension no longer aborts import', () => {
  const s = services();
  // width 0 is present-but-bad (QA concern), not a declared-vs-probed mismatch.
  const src = writeDataset(tmpDir('dsqa-src-'), {
    coco: coco({ images: [{ id: 1, file_name: 'a.png', width: 0, height: 0 }] }),
    images: { 'a.png': PNG_1x1 },
  });
  const version = s.runImport('ds1', src);
  assert.strictEqual(version.status, 'READY');
});

// Phase 4 Step 3B-1 (H1 regression): a mixed numeric/string image reference
// (image.id=1 vs annotation.image_id="1") must resolve via §6.4 normalization,
// not leak the missing-image sentinel into persistence (FOREIGN KEY failure).
test('a mixed numeric/string image id resolves — import succeeds, annotation points to the image', () => {
  const s = services();
  const src = writeDataset(tmpDir('dsqa-src-'), {
    coco: coco({ annotations: [{ id: 1, image_id: '1', category_id: 1, bbox: [0, 0, 1, 1] }] }),
    images: { 'a.png': PNG_1x1 },
  });

  const version = s.runImport('ds1', src); // must not throw FOREIGN KEY
  assert.strictEqual(version.status, 'READY');
  const rows = annots(s.db, version.id);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].image_id, `${version.id}::img::1`);
  // The resolved image row exists, so the FK is satisfied.
  assert.ok(s.db.prepare('SELECT 1 FROM images WHERE id = ?').get(rows[0].image_id));
});
