'use strict';

// Phase 2 unit test — COCO normalizer (v2.md §13). Canonical model is
// independent of raw COCO; geometry is data only.

const { test } = require('node:test');
const assert = require('node:assert');
const { normalize } = require('../../src/infrastructure/coco/CocoNormalizer');

const ctx = {
  makeImageId: (c) => `img-${c}`,
  makeAnnotationId: (c) => `ann-${c}`,
  imageHashes: new Map([[1, 'hash1']]),
};

const dto = {
  images: [{ id: 1, file_name: 'a.png', width: 10, height: 20 }],
  categories: [{ id: 5, name: 'car', supercategory: 'vehicle' }],
  annotations: [
    { id: 100, image_id: 1, category_id: 5, bbox: [1, 2, 3, 4] },
    { id: 101, image_id: 1, category_id: 5, bbox: [0, 0, 2, 2], segmentation: [[0, 0, 2, 0, 2, 2]] },
    { id: 102, image_id: 1, category_id: 5, segmentation: { counts: 'X', size: [20, 10] } },
  ],
};

test('COCO bbox becomes canonical {x,y,width,height}', () => {
  const ds = normalize(dto, ctx);
  const a = ds.annotations[0];
  assert.strictEqual(a.geometry.type, 'BBOX');
  assert.deepStrictEqual({ ...a.geometry.bbox }, { x: 1, y: 2, width: 3, height: 4 });
});

test('polygon segmentation → SEGMENTATION / POLYGON encoding', () => {
  const a = normalize(dto, ctx).annotations[1];
  assert.strictEqual(a.geometry.type, 'SEGMENTATION');
  assert.strictEqual(a.geometry.segmentation.encoding, 'POLYGON');
  assert.strictEqual(a.geometry.segmentation.polygons[0].length, 3);
});

test('RLE segmentation preserved without decoding', () => {
  const a = normalize(dto, ctx).annotations[2];
  assert.strictEqual(a.geometry.segmentation.encoding, 'RLE');
  assert.strictEqual(a.geometry.segmentation.counts, 'X');
  assert.ok(!('mask' in a.geometry.segmentation));
});

test('category name resolved, image id remapped, no review/QA fields present', () => {
  const a = normalize(dto, ctx).annotations[0];
  assert.strictEqual(a.categoryName, 'car');
  assert.strictEqual(a.imageId, 'img-1');
  assert.ok(!('decision' in a));
  assert.ok(!('severity' in a));
  assert.ok(!('status' in a));
});

test('canonical image carries content fingerprint and relative path', () => {
  const image = normalize(dto, ctx).images[0];
  assert.strictEqual(image.fingerprint, 'hash1');
  assert.strictEqual(image.relativePath, 'images/a.png');
});
