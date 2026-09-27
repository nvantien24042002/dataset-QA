'use strict';

// Phase 2 integration test — Image/Annotation repositories against a real
// (in-memory) migrated SQLite schema, including FK enforcement (v2.md §14.4).

const { test } = require('node:test');
const assert = require('node:assert');
const { memDb } = require('../helpers/fixtures');
const { DatasetRepository } = require('../../src/infrastructure/repositories/DatasetRepository');
const { DatasetVersionRepository } = require('../../src/infrastructure/repositories/DatasetVersionRepository');
const { ImageRepository } = require('../../src/infrastructure/repositories/ImageRepository');
const { AnnotationRepository } = require('../../src/infrastructure/repositories/AnnotationRepository');

function seedVersion(db) {
  const datasets = new DatasetRepository(db);
  const versions = new DatasetVersionRepository(db);
  const now = new Date().toISOString();
  datasets.upsert({ id: 'ds1', name: 'ds1', description: null, createdAt: now, updatedAt: now });
  versions.create({
    id: 'v1',
    datasetId: 'ds1',
    versionNumber: 1,
    parentVersionId: null,
    status: 'DRAFT',
    fingerprint: 'fp',
    createdAt: now,
    createdBy: null,
  });
  return { versions };
}

test('images and annotations persist and read back by version', () => {
  const db = memDb();
  seedVersion(db);
  const images = new ImageRepository(db);
  const annotations = new AnnotationRepository(db);

  images.create({
    id: 'v1::img::1',
    datasetVersionId: 'v1',
    fileName: 'a.png',
    relativePath: 'images/a.png',
    width: 10,
    height: 20,
    fingerprint: 'h',
  });
  annotations.create({
    id: 'v1::ann::1',
    datasetVersionId: 'v1',
    imageId: 'v1::img::1',
    categoryId: 5,
    categoryName: 'car',
    geometryType: 'BBOX',
    bboxJson: JSON.stringify({ x: 1, y: 2, width: 3, height: 4 }),
    segmentationJson: null,
    attributesJson: '{}',
    metadataJson: '{}',
  });

  assert.strictEqual(images.findByVersion('v1').length, 1);
  const ann = annotations.findByImage('v1', 'v1::img::1');
  assert.strictEqual(ann.length, 1);
  assert.strictEqual(JSON.parse(ann[0].bbox_json).width, 3);
});

test('an annotation referencing a missing image is rejected by the FK', () => {
  const db = memDb();
  seedVersion(db);
  const annotations = new AnnotationRepository(db);
  assert.throws(() =>
    annotations.create({
      id: 'v1::ann::bad',
      datasetVersionId: 'v1',
      imageId: 'does-not-exist',
      categoryId: 5,
      categoryName: 'car',
      geometryType: 'BBOX',
      bboxJson: '{}',
      segmentationJson: null,
      attributesJson: '{}',
      metadataJson: '{}',
    })
  );
});
