'use strict';

// Phase 4 — Step 3B-2 unit test: QADatasetView builder. Verifies the QA input
// boundary over the raw DTO + Step 3B-1 inspection, without running the engine.

const { test } = require('node:test');
const assert = require('node:assert');
const { inspectRecords } = require('../../src/application/import/recordInspection');
const { buildQADatasetView } = require('../../src/application/import/QADatasetViewBuilder');

const makeImageId = (rawId) => `v::img::${rawId}`;
const makeAnnotationId = (rawId) => `v::ann::${rawId}`;

// Build a view the way the import flow will: inspect the raw DTO, then build.
const build = (dto) =>
  buildQADatasetView({ dto, inspection: inspectRecords(dto), makeImageId, makeAnnotationId });

const dto = (overrides = {}) => ({
  images: [{ id: 1, file_name: 'a.png', width: 10, height: 20 }],
  categories: [{ id: 5, name: 'car' }],
  annotations: [{ id: 100, image_id: 1, category_id: 5, bbox: [1, 2, 3, 4] }],
  ...overrides,
});

const only = (view) => view.annotations[0];

// 1. Fully valid dataset
test('a fully valid dataset: every annotation included with non-null canonical ids', () => {
  const view = build(dto());
  assert.strictEqual(view.annotations.length, 1);
  const a = only(view);
  assert.strictEqual(a.rawId, 100);
  assert.strictEqual(a.canonicalId, 'v::ann::100');
  assert.strictEqual(a.rawImageId, 1);
  assert.strictEqual(a.canonicalImageId, 'v::img::1');
  assert.strictEqual(a.categoryId, 5);
  assert.deepStrictEqual(a.bbox, [1, 2, 3, 4]);
  assert.strictEqual(a.segmentation, null);
  assert.deepStrictEqual(view.images[0], {
    rawId: 1,
    canonicalId: 'v::img::1',
    fileName: 'a.png',
    width: 10,
    height: 20,
  });
  assert.deepStrictEqual([...view.imageIds], [1]);
  assert.deepStrictEqual([...view.categoryIds], [5]);
});

// 2. Dangling image
test('dangling image: annotation preserved, canonicalImageId and canonicalId null', () => {
  const view = build(dto({ annotations: [{ id: 100, image_id: 999, category_id: 5, bbox: [1, 2, 3, 4] }] }));
  const a = only(view);
  assert.strictEqual(a.canonicalImageId, null);
  assert.strictEqual(a.canonicalId, null);
  assert.strictEqual(a.rawImageId, 999); // preserved
});

// 3. Dangling category
test('dangling category: canonical ids present, raw categoryId preserved', () => {
  const view = build(dto({ annotations: [{ id: 100, image_id: 1, category_id: 777, bbox: [1, 2, 3, 4] }] }));
  const a = only(view);
  assert.strictEqual(a.canonicalImageId, 'v::img::1');
  assert.strictEqual(a.canonicalId, 'v::ann::100');
  assert.strictEqual(a.categoryId, 777);
});

// 4. Unbuildable bbox without segmentation
test('unbuildable bbox without segmentation: canonicalId null, raw bbox preserved', () => {
  const view = build(dto({ annotations: [{ id: 100, image_id: 1, category_id: 5, bbox: [1, 2, -5, 4] }] }));
  const a = only(view);
  assert.strictEqual(a.canonicalId, null);
  assert.deepStrictEqual(a.bbox, [1, 2, -5, 4]); // raw preserved for INVALID_BBOX
  assert.strictEqual(a.canonicalImageId, 'v::img::1'); // image still resolves
});

// 5. Bad bbox + valid segmentation
test('bad bbox + valid segmentation: canonical ids present, ORIGINAL raw bbox preserved', () => {
  const view = build(
    dto({
      annotations: [
        { id: 100, image_id: 1, category_id: 5, bbox: [1, 2, -5, 4], segmentation: [[0, 0, 2, 0, 2, 2]] },
      ],
    })
  );
  const a = only(view);
  assert.strictEqual(a.canonicalId, 'v::ann::100'); // normalized as segmentation-only
  assert.strictEqual(a.canonicalImageId, 'v::img::1');
  assert.deepStrictEqual(a.bbox, [1, 2, -5, 4]); // ORIGINAL raw bbox, not the stripped one
  assert.deepStrictEqual(a.segmentation, [[0, 0, 2, 0, 2, 2]]);
});

// 6. Present-but-invalid image dimensions
test('present-but-invalid image dimensions: image stays in view with raw values', () => {
  const view = build(dto({ images: [{ id: 1, file_name: 'a.png', width: 0, height: -5 }], annotations: [] }));
  assert.strictEqual(view.images.length, 1);
  assert.strictEqual(view.images[0].width, 0);
  assert.strictEqual(view.images[0].height, -5);
});

// 7. Mixed numeric/string image reference (H1 behavior)
test('mixed numeric/string image reference resolves (image.id=1, image_id="1")', () => {
  const view = build(dto({ annotations: [{ id: 100, image_id: '1', category_id: 5, bbox: [1, 2, 3, 4] }] }));
  const a = only(view);
  assert.strictEqual(a.canonicalImageId, 'v::img::1');
  assert.strictEqual(a.canonicalId, 'v::ann::100');
  assert.strictEqual(a.rawImageId, '1'); // raw form preserved
});

// 8. Non-numeric image reference
test('non-numeric image reference does not resolve', () => {
  const view = build(dto({ annotations: [{ id: 100, image_id: 'abc', category_id: 5, bbox: [1, 2, 3, 4] }] }));
  const a = only(view);
  assert.strictEqual(a.canonicalImageId, null);
  assert.strictEqual(a.canonicalId, null);
});

// 9. Segmentation-only annotation
test('segmentation-only annotation: bbox is null', () => {
  const view = build(dto({ annotations: [{ id: 100, image_id: 1, category_id: 5, segmentation: [[0, 0, 2, 0, 2, 2]] }] }));
  const a = only(view);
  assert.strictEqual(a.bbox, null);
  assert.deepStrictEqual(a.segmentation, [[0, 0, 2, 0, 2, 2]]);
  assert.strictEqual(a.canonicalId, 'v::ann::100');
});

// 10. Raw Set semantics
test('imageIds and categoryIds contain RAW ids, not normalized', () => {
  const view = build(
    dto({
      images: [{ id: '1', file_name: 'a.png', width: 10, height: 20 }],
      categories: [{ id: '5', name: 'car' }],
      annotations: [{ id: 100, image_id: '1', category_id: '5', bbox: [1, 2, 3, 4] }],
    })
  );
  assert.deepStrictEqual([...view.imageIds], ['1']); // raw string, not number 1
  assert.deepStrictEqual([...view.categoryIds], ['5']);
});

// 11. No mutation
test('the builder mutates neither the dto nor the inspection result', () => {
  const d = dto({
    annotations: [
      { id: 100, image_id: 1, category_id: 5, bbox: [1, 2, 3, 4] },
      { id: 101, image_id: 999, category_id: 5, bbox: [1, 2, -5, 4] },
    ],
  });
  const inspection = inspectRecords(d);
  const dtoBefore = JSON.stringify(d);
  const inspBefore = JSON.stringify({
    forNormalize: inspection.annotationsForNormalize,
    excluded: inspection.excludedAnnotations,
    dims: [...inspection.invalidDimensionImageIds],
  });
  buildQADatasetView({ dto: d, inspection, makeImageId, makeAnnotationId });
  assert.strictEqual(JSON.stringify(d), dtoBefore);
  assert.strictEqual(
    JSON.stringify({
      forNormalize: inspection.annotationsForNormalize,
      excluded: inspection.excludedAnnotations,
      dims: [...inspection.invalidDimensionImageIds],
    }),
    inspBefore
  );
});

// 12. Shape stability
test('view exposes only the agreed fields — no COCO wire aliases, no QA/review fields', () => {
  const view = build(dto());
  assert.deepStrictEqual(Object.keys(view).sort(), ['annotations', 'categoryIds', 'imageIds', 'images']);
  assert.deepStrictEqual(Object.keys(view.images[0]).sort(), ['canonicalId', 'fileName', 'height', 'rawId', 'width']);
  assert.deepStrictEqual(
    Object.keys(view.annotations[0]).sort(),
    ['bbox', 'canonicalId', 'canonicalImageId', 'categoryId', 'rawId', 'rawImageId', 'segmentation']
  );
  const forbidden = ['image_id', 'category_id', 'file_name', 'id', 'imageId', 'type', 'severity', 'decision', 'reviewer'];
  for (const key of forbidden) {
    assert.ok(!(key in view.annotations[0]), `annotation must not expose ${key}`);
  }
});

// Immutability
test('the view object and its nested records/arrays are frozen', () => {
  const view = build(dto());
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.images));
  assert.ok(Object.isFrozen(view.annotations));
  assert.ok(Object.isFrozen(view.images[0]));
  assert.ok(Object.isFrozen(view.annotations[0]));
});

// Every annotation preserved, including excluded ones, in input order.
test('every annotation appears in the view, excluded or not, in input order', () => {
  const view = build(
    dto({
      annotations: [
        { id: 1, image_id: 1, category_id: 5, bbox: [1, 2, 3, 4] }, // valid
        { id: 2, image_id: 999, category_id: 5, bbox: [1, 2, 3, 4] }, // dangling image
        { id: 3, image_id: 1, category_id: 5, bbox: [1, 2, -5, 4] }, // unbuildable bbox
      ],
    })
  );
  assert.deepStrictEqual(view.annotations.map((a) => a.rawId), [1, 2, 3]);
  assert.deepStrictEqual(view.annotations.map((a) => a.canonicalId), ['v::ann::1', null, null]);
});
