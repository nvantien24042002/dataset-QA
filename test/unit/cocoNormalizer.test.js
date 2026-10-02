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

// Phase 4 Step 3B-1 (H1 fix): references resolve by the shared §6.4
// normalizeId policy, so a numeric image.id matches a string image_id.
test('image reference resolves across numeric/string id forms (§6.4) — no sentinel', () => {
  const mixed = {
    images: [{ id: 1, file_name: 'a.png', width: 10, height: 20 }],
    categories: [{ id: 5, name: 'car' }],
    annotations: [{ id: 100, image_id: '1', category_id: '5', bbox: [1, 2, 3, 4] }],
  };
  const a = normalize(mixed, ctx).annotations[0];
  assert.strictEqual(a.imageId, 'img-1'); // real canonical id, not __MISSING_IMAGE__
  assert.ok(!a.imageId.startsWith('__MISSING_IMAGE__'));
  assert.strictEqual(a.categoryName, 'car'); // category name resolved across "5" vs 5
});

test('a truly dangling image_id still becomes the missing-image sentinel with the original id', () => {
  const mixed = {
    images: [{ id: 1, file_name: 'a.png', width: 10, height: 20 }],
    categories: [{ id: 5, name: 'car' }],
    annotations: [{ id: 100, image_id: 999, category_id: 5, bbox: [1, 2, 3, 4] }],
  };
  const a = normalize(mixed, ctx).annotations[0];
  assert.strictEqual(a.imageId, '__MISSING_IMAGE__::999');
});

test('a non-numeric image_id does not accidentally match a numeric image.id', () => {
  const mixed = {
    images: [{ id: 1, file_name: 'a.png', width: 10, height: 20 }],
    categories: [{ id: 5, name: 'car' }],
    annotations: [{ id: 100, image_id: 'abc', category_id: 5, bbox: [1, 2, 3, 4] }],
  };
  const a = normalize(mixed, ctx).annotations[0];
  assert.strictEqual(a.imageId, '__MISSING_IMAGE__::abc');
});
