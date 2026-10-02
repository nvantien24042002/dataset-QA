'use strict';

// Phase 4 — Step 3B-4 unit test: geometry eligibility / cascade gating. Uses
// fabricated QADatasetView objects and fabricated invalidSets (no engine, no
// COCO import), so the gate is tested in isolation.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  geometryIneligibleAnnotationIds,
  isGeometryEligible,
} = require('../../src/domain/qa/geometryEligibility');

const viewImg = (overrides = {}) => ({
  rawId: 1,
  canonicalId: 'v::img::1',
  fileName: 'a.png',
  width: 10,
  height: 20,
  ...overrides,
});
const viewAnn = (overrides = {}) => ({
  rawId: 100,
  canonicalId: 'v::ann::100',
  rawImageId: 1,
  canonicalImageId: 'v::img::1',
  categoryId: 5,
  bbox: [1, 2, 3, 4],
  segmentation: null,
  ...overrides,
});
const view = ({ images, annotations } = {}) => ({
  images: images || [viewImg()],
  annotations: annotations || [viewAnn()],
  imageIds: new Set((images || [viewImg()]).map((i) => i.rawId)),
  categoryIds: new Set([5]),
});
const sets = (overrides = {}) => ({
  invalidImageReferenceAnnotationIds: new Set(),
  invalidCategoryReferenceAnnotationIds: new Set(),
  invalidBBoxAnnotationIds: new Set(),
  invalidDimensionImageIds: new Set(),
  ...overrides,
});

// 1. Empty invalid sets
test('empty invalid sets → derived set empty, all eligible', () => {
  const v = view();
  const ineligible = geometryIneligibleAnnotationIds(v, sets());
  assert.strictEqual(ineligible.size, 0);
  assert.strictEqual(isGeometryEligible(v.annotations[0], ineligible), true);
});

// 2. INVALID_IMAGE_REFERENCE
test('image-reference invalid → annotation ineligible', () => {
  const ineligible = geometryIneligibleAnnotationIds(
    view(),
    sets({ invalidImageReferenceAnnotationIds: new Set([100]) })
  );
  assert.deepStrictEqual([...ineligible], [100]);
});

// 3. INVALID_BBOX
test('bbox invalid → annotation ineligible', () => {
  const ineligible = geometryIneligibleAnnotationIds(
    view(),
    sets({ invalidBBoxAnnotationIds: new Set([100]) })
  );
  assert.deepStrictEqual([...ineligible], [100]);
});

// 4. INVALID_IMAGE_DIMENSION → every annotation on that image
test('dimension-invalid image → every annotation on it is ineligible', () => {
  const v = view({
    images: [viewImg({ rawId: 1, canonicalId: 'v::img::1' })],
    annotations: [
      viewAnn({ rawId: 100, rawImageId: 1, canonicalImageId: 'v::img::1' }),
      viewAnn({ rawId: 101, rawImageId: 1, canonicalImageId: 'v::img::1' }),
    ],
  });
  const ineligible = geometryIneligibleAnnotationIds(v, sets({ invalidDimensionImageIds: new Set([1]) }));
  assert.deepStrictEqual([...ineligible].sort((a, b) => a - b), [100, 101]);
});

// 5. A different dimension-invalid image leaves unrelated annotations eligible
test('a different image being dimension-invalid leaves unrelated annotations eligible', () => {
  const v = view({
    images: [viewImg({ rawId: 1, canonicalId: 'v::img::1' }), viewImg({ rawId: 2, canonicalId: 'v::img::2' })],
    annotations: [viewAnn({ rawId: 100, rawImageId: 1, canonicalImageId: 'v::img::1' })],
  });
  const ineligible = geometryIneligibleAnnotationIds(v, sets({ invalidDimensionImageIds: new Set([2]) }));
  assert.strictEqual(ineligible.size, 0);
});

// 6. Category-reference only → still eligible
test('category-reference invalid only → annotation remains eligible', () => {
  const ineligible = geometryIneligibleAnnotationIds(
    view(),
    sets({ invalidCategoryReferenceAnnotationIds: new Set([100]) })
  );
  assert.strictEqual(ineligible.size, 0);
});

// 7. Both image-reference and bbox → one membership
test('annotation in both image-reference and bbox sets → exactly one ineligible membership', () => {
  const ineligible = geometryIneligibleAnnotationIds(
    view(),
    sets({ invalidImageReferenceAnnotationIds: new Set([100]), invalidBBoxAnnotationIds: new Set([100]) })
  );
  assert.deepStrictEqual([...ineligible], [100]); // once, not twice
});

// 8. Mixed raw numeric/string image reference resolves via canonicalImageId
test('mixed numeric/string image reference: dimension-invalid image still suppresses', () => {
  // image rawId = 1 (number); annotation rawImageId = "1" (string) but the view
  // already resolved canonicalImageId to the image's canonicalId.
  const v = view({
    images: [viewImg({ rawId: 1, canonicalId: 'v::img::1' })],
    annotations: [viewAnn({ rawId: 100, rawImageId: '1', canonicalImageId: 'v::img::1' })],
  });
  const ineligible = geometryIneligibleAnnotationIds(v, sets({ invalidDimensionImageIds: new Set([1]) }));
  assert.deepStrictEqual([...ineligible], [100]);
});

// 9. Non-numeric/dangling image: canonicalImageId null, image-ref set controls
test('dangling image (canonicalImageId null): image-reference set controls eligibility', () => {
  const v = view({ annotations: [viewAnn({ rawId: 100, rawImageId: 'abc', canonicalImageId: null })] });
  // Not in image-ref set yet → not suppressed by the dimension cascade (null id).
  assert.strictEqual(geometryIneligibleAnnotationIds(v, sets()).size, 0);
  // In image-ref set → ineligible.
  const ineligible = geometryIneligibleAnnotationIds(v, sets({ invalidImageReferenceAnnotationIds: new Set([100]) }));
  assert.deepStrictEqual([...ineligible], [100]);
});

test('a dimension-invalid image never matches a null canonicalImageId annotation', () => {
  const v = view({
    images: [viewImg({ rawId: 1, canonicalId: 'v::img::1' })],
    annotations: [viewAnn({ rawId: 100, rawImageId: 'abc', canonicalImageId: null })],
  });
  // Dimension set has image 1, but the annotation resolves to no image.
  assert.strictEqual(geometryIneligibleAnnotationIds(v, sets({ invalidDimensionImageIds: new Set([1]) })).size, 0);
});

// 10. Segmentation-only → eligible
test('segmentation-only annotation (bbox null) with no invalidity → eligible', () => {
  const v = view({ annotations: [viewAnn({ bbox: null, segmentation: [[0, 0, 2, 0, 2, 2]] })] });
  assert.strictEqual(geometryIneligibleAnnotationIds(v, sets()).size, 0);
});

// 11. Negative-origin valid bbox → eligible
test('negative-origin valid bbox with no invalidity → eligible', () => {
  const v = view({ annotations: [viewAnn({ bbox: [-10, -5, 20, 20] })] });
  assert.strictEqual(geometryIneligibleAnnotationIds(v, sets()).size, 0);
});

// 12. Edge-touching valid bbox → eligible
test('edge-touching valid bbox with no invalidity → eligible', () => {
  const v = view({ annotations: [viewAnn({ bbox: [0, 0, 10, 20] })] }); // touches right/bottom edge of 10x20
  assert.strictEqual(geometryIneligibleAnnotationIds(v, sets()).size, 0);
});

// 13. Compound invalid conditions across multiple annotations
test('compound invalid conditions still produce one membership per annotation', () => {
  const v = view({
    images: [viewImg({ rawId: 1, canonicalId: 'v::img::1' })],
    annotations: [
      viewAnn({ rawId: 100, rawImageId: 1, canonicalImageId: 'v::img::1' }),
      viewAnn({ rawId: 101, rawImageId: 1, canonicalImageId: 'v::img::1' }),
    ],
  });
  const ineligible = geometryIneligibleAnnotationIds(
    v,
    sets({
      invalidImageReferenceAnnotationIds: new Set([100]),
      invalidBBoxAnnotationIds: new Set([100]),
      invalidDimensionImageIds: new Set([1]), // also covers 100 and 101
    })
  );
  assert.deepStrictEqual([...ineligible].sort((a, b) => a - b), [100, 101]);
});

// 14. Empty / no matching dimension-invalid image does not throw
test('no matching dimension-invalid image does not throw and yields eligible', () => {
  const v = view();
  assert.doesNotThrow(() => geometryIneligibleAnnotationIds(v, sets({ invalidDimensionImageIds: new Set([999]) })));
  assert.strictEqual(geometryIneligibleAnnotationIds(v, sets({ invalidDimensionImageIds: new Set([999]) })).size, 0);
});

test('an empty view yields an empty derived set', () => {
  const empty = { images: [], annotations: [], imageIds: new Set(), categoryIds: new Set() };
  assert.strictEqual(geometryIneligibleAnnotationIds(empty, sets()).size, 0);
});

// 15. Input immutability
test('the gate mutates neither the view nor the invalidSets', () => {
  const v = view({
    images: [viewImg({ rawId: 1 })],
    annotations: [viewAnn({ rawId: 100 }), viewAnn({ rawId: 101, categoryId: 5 })],
  });
  const s = sets({ invalidBBoxAnnotationIds: new Set([101]), invalidDimensionImageIds: new Set([1]) });
  const vBefore = JSON.stringify({ images: v.images, annotations: v.annotations });
  const sBefore = JSON.stringify({
    imgRef: [...s.invalidImageReferenceAnnotationIds],
    catRef: [...s.invalidCategoryReferenceAnnotationIds],
    bbox: [...s.invalidBBoxAnnotationIds],
    dim: [...s.invalidDimensionImageIds],
  });
  geometryIneligibleAnnotationIds(v, s);
  assert.strictEqual(JSON.stringify({ images: v.images, annotations: v.annotations }), vBefore);
  assert.strictEqual(
    JSON.stringify({
      imgRef: [...s.invalidImageReferenceAnnotationIds],
      catRef: [...s.invalidCategoryReferenceAnnotationIds],
      bbox: [...s.invalidBBoxAnnotationIds],
      dim: [...s.invalidDimensionImageIds],
    }),
    sBefore
  );
});

// 16. Determinism
test('repeated calls on the same inputs produce equivalent set contents', () => {
  const v = view({
    images: [viewImg({ rawId: 1 })],
    annotations: [viewAnn({ rawId: 100 }), viewAnn({ rawId: 101 })],
  });
  const s = sets({ invalidImageReferenceAnnotationIds: new Set([100]), invalidDimensionImageIds: new Set([1]) });
  const a = [...geometryIneligibleAnnotationIds(v, s)].sort((x, y) => x - y);
  const b = [...geometryIneligibleAnnotationIds(v, s)].sort((x, y) => x - y);
  assert.deepStrictEqual(a, b);
});

// 17. Category-reference isolation
test('toggling an annotation in the category-reference set never changes geometry eligibility', () => {
  const v = view();
  const without = geometryIneligibleAnnotationIds(v, sets());
  const withCat = geometryIneligibleAnnotationIds(
    v,
    sets({ invalidCategoryReferenceAnnotationIds: new Set([100]) })
  );
  assert.deepStrictEqual([...without], [...withCat]);
  assert.strictEqual(withCat.size, 0);
});

// 18. No issue descriptors — return is a Set of raw ids only
test('the gate returns only a Set of raw annotation ids, not issue descriptors', () => {
  const ineligible = geometryIneligibleAnnotationIds(view(), sets({ invalidBBoxAnnotationIds: new Set([100]) }));
  assert.ok(ineligible instanceof Set);
  for (const value of ineligible) {
    assert.ok(typeof value === 'number' || typeof value === 'string'); // a raw id, not an object
    assert.strictEqual(typeof value === 'object', false);
  }
});

// 19. No imports
test('geometryEligibility.js has zero require/import statements', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/domain/qa/geometryEligibility.js'), 'utf8');
  assert.deepStrictEqual([...src.matchAll(/\brequire\s*\(/g)], []);
  assert.deepStrictEqual([...src.matchAll(/^\s*import\s/gm)], []);
});

// 20. Shape discipline — no canonical-id construction, no normalizeId, no persistence
test('the module constructs no canonical ids and references no normalization/persistence', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/domain/qa/geometryEligibility.js'), 'utf8');
  const code = src.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(!/normalizeId/.test(code));
  assert.ok(!/makeImageId|makeAnnotationId|::img::|::ann::/.test(code)); // never builds canonical ids
  assert.ok(!/require|sqlite|repository|persistence/i.test(code));
});
