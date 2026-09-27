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
