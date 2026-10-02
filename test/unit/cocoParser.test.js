'use strict';

// Phase 2 unit test — COCO parser structural validation (v2.md §13).

const { test } = require('node:test');
const assert = require('node:assert');
const { parseCoco } = require('../../src/infrastructure/coco/CocoParser');

const valid = {
  images: [{ id: 1, file_name: 'a.png', width: 1, height: 1 }],
  categories: [{ id: 1, name: 'x' }],
  annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1] }],
};

test('parses a valid COCO document', () => {
  const dto = parseCoco(JSON.stringify(valid));
  assert.strictEqual(dto.images.length, 1);
  assert.strictEqual(dto.annotations.length, 1);
});

test('rejects invalid JSON', () => {
  assert.throws(() => parseCoco('{bad'), /valid JSON/);
});

test('rejects a document missing the annotations array', () => {
  assert.throws(() => parseCoco(JSON.stringify({ images: [], categories: [] })), /annotations/);
});

test('rejects an image without file_name', () => {
  const doc = { images: [{ id: 1, width: 1, height: 1 }], categories: [], annotations: [] };
  assert.throws(() => parseCoco(JSON.stringify(doc)), /file_name/);
});

test('rejects an annotation without image_id', () => {
  const doc = { images: [], categories: [], annotations: [{ id: 1, category_id: 1 }] };
  assert.throws(() => parseCoco(JSON.stringify(doc)), /image_id/);
});

// Phase 4 Step 3B-1: a MISSING width/height is still fatal (structural), but a
// PRESENT-but-invalid value is NOT — it must survive parsing to become a
// record-level QA issue (INVALID_IMAGE_DIMENSION, v1.md §16B).
test('rejects an image with a missing width or height field (fatal, v1.md §5 row 6)', () => {
  const noWidth = { images: [{ id: 1, file_name: 'a.png', height: 1 }], categories: [], annotations: [] };
  const noHeight = { images: [{ id: 1, file_name: 'a.png', width: 1 }], categories: [], annotations: [] };
  assert.throws(() => parseCoco(JSON.stringify(noWidth)), /width/);
  assert.throws(() => parseCoco(JSON.stringify(noHeight)), /height/);
});

test('accepts an image with present-but-invalid dimensions (deferred to QA)', () => {
  for (const dims of [{ width: 0, height: 1 }, { width: -1, height: 1 }, { width: 'x', height: 1 }]) {
    const doc = {
      images: [{ id: 1, file_name: 'a.png', ...dims }],
      categories: [],
      annotations: [],
    };
    const dto = parseCoco(JSON.stringify(doc));
    assert.strictEqual(dto.images.length, 1);
  }
});

// NaN/Infinity cannot appear in JSON, but the parser accepts raw objects too.
test('accepts present-but-non-finite dimensions from a raw object (deferred to QA)', () => {
  const doc = { images: [{ id: 1, file_name: 'a.png', width: NaN, height: Infinity }], categories: [], annotations: [] };
  assert.strictEqual(parseCoco(doc).images.length, 1);
});
