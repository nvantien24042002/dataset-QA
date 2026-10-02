'use strict';

// Phase 4 — Step 3B-1 unit test: the import record-level QA boundary
// (recordInspection). Verifies the partition of a raw COCO DTO without running
// the QA engine: what is held back from the strict normalizer, what survives,
// and the invalid-dimension set.

const { test } = require('node:test');
const assert = require('node:assert');
const { inspectRecords } = require('../../src/application/import/recordInspection');

const dto = (overrides = {}) => ({
  images: [{ id: 1, file_name: 'a.png', width: 10, height: 10 }],
  categories: [{ id: 1, name: 'c' }],
  annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 2, 2] }],
  ...overrides,
});

const ids = (list) => list.map((a) => a.id);

test('a fully valid DTO passes every annotation through unchanged', () => {
  const d = dto();
  const r = inspectRecords(d);
  assert.deepStrictEqual(ids(r.annotationsForNormalize), [1]);
  assert.deepStrictEqual(r.excludedAnnotations, []);
  assert.strictEqual(r.invalidDimensionImageIds.size, 0);
});

test('a dangling image reference is held back from normalization', () => {
  const r = inspectRecords(
    dto({ annotations: [{ id: 1, image_id: 999, category_id: 1, bbox: [0, 0, 2, 2] }] })
  );
  assert.deepStrictEqual(ids(r.annotationsForNormalize), []);
  assert.strictEqual(r.excludedAnnotations.length, 1);
  assert.deepStrictEqual(r.excludedAnnotations[0].reasons, ['INVALID_IMAGE_REFERENCE']);
});

test('image reference matching normalizes ids: image.id 1 matches image_id "1"', () => {
  const r = inspectRecords(
    dto({ annotations: [{ id: 1, image_id: '1', category_id: 1, bbox: [0, 0, 2, 2] }] })
  );
  assert.deepStrictEqual(ids(r.annotationsForNormalize), [1]);
  assert.deepStrictEqual(r.excludedAnnotations, []);
});

test('a dangling category reference stays in — the annotation is otherwise valid', () => {
  const r = inspectRecords(
    dto({ annotations: [{ id: 1, image_id: 1, category_id: 777, bbox: [0, 0, 2, 2] }] })
  );
  assert.deepStrictEqual(ids(r.annotationsForNormalize), [1]);
  assert.deepStrictEqual(r.excludedAnnotations, []);
});

test('a malformed bbox with no segmentation is unbuildable and held back', () => {
  for (const bbox of [[0, 0, -5, 2], [0, 0, 2, 2, 9], [0, 0, 'x', 2], 'nope']) {
    const r = inspectRecords(
      dto({ annotations: [{ id: 1, image_id: 1, category_id: 1, bbox }] })
    );
    assert.deepStrictEqual(ids(r.annotationsForNormalize), [], JSON.stringify(bbox));
    assert.strictEqual(r.excludedAnnotations.length, 1);
    assert.ok(r.excludedAnnotations[0].reasons.includes('INVALID_BBOX'));
  }
});

test('a malformed bbox WITH a segmentation is kept as segmentation-only (bbox dropped)', () => {
  const r = inspectRecords(
    dto({
      annotations: [
        { id: 1, image_id: 1, category_id: 1, bbox: [0, 0, -5, 2], segmentation: [[0, 0, 2, 0, 2, 2]] },
      ],
    })
  );
  assert.strictEqual(r.annotationsForNormalize.length, 1);
  assert.strictEqual(r.annotationsForNormalize[0].bbox, undefined);
  assert.ok('segmentation' in r.annotationsForNormalize[0]);
  assert.strictEqual(r.excludedAnnotations.length, 0); // kept, not excluded
});

test('a numeric-string but value-valid bbox is coerced to numbers for strict construction', () => {
  const r = inspectRecords(
    dto({ annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: ['0', '0', '2', '2'] }] })
  );
  assert.deepStrictEqual(r.annotationsForNormalize[0].bbox, [0, 0, 2, 2]);
});

test('a negative-origin bbox is value-valid and passes through untouched', () => {
  const r = inspectRecords(
    dto({ annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [-10, -5, 20, 20] }] })
  );
  assert.deepStrictEqual(r.annotationsForNormalize[0].bbox, [-10, -5, 20, 20]);
});

test('a segmentation-only annotation (no bbox) passes through', () => {
  const r = inspectRecords(
    dto({ annotations: [{ id: 1, image_id: 1, category_id: 1, segmentation: [[0, 0, 2, 0, 2, 2]] }] })
  );
  assert.deepStrictEqual(ids(r.annotationsForNormalize), [1]);
});

test('value-invalid declared dimensions are collected (present-but-bad, not missing)', () => {
  const r = inspectRecords(
    dto({
      images: [
        { id: 1, file_name: 'a.png', width: 0, height: 10 },
        { id: 2, file_name: 'b.png', width: -1, height: 10 },
        { id: 3, file_name: 'c.png', width: 10, height: 10 },
      ],
      annotations: [],
    })
  );
  assert.deepStrictEqual([...r.invalidDimensionImageIds].sort(), [1, 2]);
});

test('a dangling-image record carries both reasons when its bbox is also invalid', () => {
  const r = inspectRecords(
    dto({ annotations: [{ id: 1, image_id: 999, category_id: 1, bbox: [0, 0, 0, 2] }] })
  );
  assert.strictEqual(r.excludedAnnotations.length, 1);
  assert.deepStrictEqual(r.excludedAnnotations[0].reasons.sort(), [
    'INVALID_BBOX',
    'INVALID_IMAGE_REFERENCE',
  ]);
});

test('inspection does not mutate the input DTO', () => {
  const d = dto({ annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: ['0', '0', '2', '2'] }] });
  const before = JSON.stringify(d);
  inspectRecords(d);
  assert.strictEqual(JSON.stringify(d), before);
});
