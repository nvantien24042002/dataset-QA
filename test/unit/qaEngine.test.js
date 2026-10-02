'use strict';

// Phase 4 — Step 3B-3 unit test: runQaEngine record-rule orchestrator. Uses
// FABRICATED QADatasetView objects (no COCO import) so the engine is tested in
// isolation from parsing/normalization.

const { test } = require('node:test');
const assert = require('node:assert');
const { runQaEngine } = require('../../src/domain/qa/runQaEngine');

// A minimal valid view: one image, one annotation that references it.
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
const viewImg = (overrides = {}) => ({
  rawId: 1,
  canonicalId: 'v::img::1',
  fileName: 'a.png',
  width: 10,
  height: 20,
  ...overrides,
});
const view = ({ images, annotations, imageIds, categoryIds } = {}) => {
  const imgs = images || [viewImg()];
  const anns = annotations || [viewAnn()];
  return {
    images: imgs,
    annotations: anns,
    imageIds: imageIds || new Set(imgs.map((i) => i.rawId)),
    categoryIds: categoryIds || new Set([5]),
  };
};

const types = (r) => r.issues.map((i) => i.type);

// 1. Valid image + valid annotation
test('a fully valid view yields no issues and empty invalid sets', () => {
  const r = runQaEngine(view());
  assert.deepStrictEqual([...r.issues], []);
  assert.strictEqual(r.invalidSets.invalidImageReferenceAnnotationIds.size, 0);
  assert.strictEqual(r.invalidSets.invalidCategoryReferenceAnnotationIds.size, 0);
  assert.strictEqual(r.invalidSets.invalidBBoxAnnotationIds.size, 0);
  assert.strictEqual(r.invalidSets.invalidDimensionImageIds.size, 0);
  assert.strictEqual(r.summary.totalIssues, 0);
});

// 2. Dangling image
test('dangling image → INVALID_IMAGE_REFERENCE in the image set only', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ rawImageId: 999, canonicalImageId: null, canonicalId: null })] }));
  assert.deepStrictEqual(types(r), ['INVALID_IMAGE_REFERENCE']);
  assert.ok(r.invalidSets.invalidImageReferenceAnnotationIds.has(100));
  assert.ok(!r.invalidSets.invalidCategoryReferenceAnnotationIds.has(100));
});

// 3. Dangling category
test('dangling category → INVALID_CATEGORY_REFERENCE in the category set only', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ categoryId: 777 })] }));
  assert.deepStrictEqual(types(r), ['INVALID_CATEGORY_REFERENCE']);
  assert.ok(r.invalidSets.invalidCategoryReferenceAnnotationIds.has(100));
  assert.ok(!r.invalidSets.invalidImageReferenceAnnotationIds.has(100));
});

// 4. Malformed bbox
test('malformed bbox → INVALID_BBOX, raw annotation id in the bbox set', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ bbox: [1, 2, -5, 4] })] }));
  assert.deepStrictEqual(types(r), ['INVALID_BBOX']);
  assert.ok(r.invalidSets.invalidBBoxAnnotationIds.has(100));
});

// 5. Bad bbox + valid segmentation: the engine still sees the ORIGINAL raw bbox
test('bad bbox + segmentation → INVALID_BBOX reported from the original raw bbox', () => {
  const r = runQaEngine(
    view({ annotations: [viewAnn({ bbox: [1, 2, -5, 4], segmentation: [[0, 0, 2, 0, 2, 2]] })] })
  );
  assert.deepStrictEqual(types(r), ['INVALID_BBOX']);
  assert.deepStrictEqual(r.issues[0].details.bbox, [1, 2, -5, 4]);
});

// 6. Invalid image dimensions
test('invalid image dimensions → INVALID_IMAGE_DIMENSION, raw image id in the dimension set', () => {
  const r = runQaEngine(view({ images: [viewImg({ width: 0 })], annotations: [] }));
  assert.deepStrictEqual(types(r), ['INVALID_IMAGE_DIMENSION']);
  assert.ok(r.invalidSets.invalidDimensionImageIds.has(1));
});

// 7. Negative x/y but otherwise valid bbox
test('negative x/y with valid size → no INVALID_BBOX', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ bbox: [-10, -5, 20, 20] })] }));
  assert.deepStrictEqual([...r.issues], []);
});

// 8. Mixed numeric/string image ids resolve (H1)
test('mixed numeric/string image ids resolve → no INVALID_IMAGE_REFERENCE', () => {
  // image rawId = 1 (number), annotation rawImageId = "1" (string), imageIds raw.
  const r = runQaEngine(view({ annotations: [viewAnn({ rawImageId: '1' })] }));
  assert.deepStrictEqual([...r.issues], []);
});

// 9. Non-numeric image reference
test('non-numeric image reference → INVALID_IMAGE_REFERENCE', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ rawImageId: 'abc' })] }));
  assert.deepStrictEqual(types(r), ['INVALID_IMAGE_REFERENCE']);
});

// 10. All four rule outputs concatenate
test('all four rules execute and concatenate in registry order', () => {
  const r = runQaEngine(
    view({
      images: [viewImg({ rawId: 1 }), viewImg({ rawId: 2, canonicalId: 'v::img::2', width: 0 })],
      annotations: [
        viewAnn({ rawId: 10, rawImageId: 999, canonicalImageId: null, canonicalId: null }), // image ref
        viewAnn({ rawId: 11, categoryId: 777 }), // category ref
        viewAnn({ rawId: 12, bbox: [0, 0, 0, 5] }), // bbox
      ],
      imageIds: new Set([1, 2]),
      categoryIds: new Set([5]),
    })
  );
  // Order: image-ref, category-ref, bbox, dimension.
  assert.deepStrictEqual(types(r), [
    'INVALID_IMAGE_REFERENCE',
    'INVALID_CATEGORY_REFERENCE',
    'INVALID_BBOX',
    'INVALID_IMAGE_DIMENSION',
  ]);
});

// 11. Invalid sets remain separate
test('image-reference and category-reference invalid sets are not merged', () => {
  const r = runQaEngine(
    view({
      annotations: [
        viewAnn({ rawId: 10, rawImageId: 999, canonicalImageId: null, canonicalId: null }),
        viewAnn({ rawId: 11, categoryId: 777 }),
      ],
    })
  );
  assert.deepStrictEqual([...r.invalidSets.invalidImageReferenceAnnotationIds], [10]);
  assert.deepStrictEqual([...r.invalidSets.invalidCategoryReferenceAnnotationIds], [11]);
});

// 12. Summary shape
test('summary has totalIssues, all four severity keys, all nine type keys', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ bbox: [0, 0, 0, 5] })] }));
  assert.strictEqual(r.summary.totalIssues, 1);
  assert.deepStrictEqual(Object.keys(r.summary.severityCounts), ['HIGH', 'MEDIUM', 'LOW', 'INFO']);
  assert.deepStrictEqual(Object.keys(r.summary.issueTypeCounts), [
    'MISSING_ANNOTATION',
    'SMALL_OBJECT',
    'TRUNCATED',
    'CLASS_IMBALANCE',
    'INVALID_IMAGE_REFERENCE',
    'INVALID_CATEGORY_REFERENCE',
    'INVALID_BBOX',
    'OUT_OF_BOUNDS_BBOX',
    'INVALID_IMAGE_DIMENSION',
  ]);
  assert.strictEqual(r.summary.severityCounts.HIGH, 1);
  assert.strictEqual(r.summary.severityCounts.MEDIUM, 0);
  assert.strictEqual(r.summary.issueTypeCounts.INVALID_BBOX, 1);
  assert.strictEqual(r.summary.issueTypeCounts.SMALL_OBJECT, 0); // present, zero
});

test('only the four INVALID_* types can be non-zero in this step', () => {
  const r = runQaEngine(
    view({
      images: [viewImg({ width: 0 })],
      annotations: [
        viewAnn({ rawId: 10, rawImageId: 999, canonicalImageId: null, canonicalId: null }),
        viewAnn({ rawId: 11, categoryId: 777 }),
        viewAnn({ rawId: 12, bbox: [0, 0, 0, 5] }),
      ],
    })
  );
  const nonZero = Object.entries(r.summary.issueTypeCounts).filter(([, n]) => n > 0).map(([t]) => t);
  assert.deepStrictEqual(nonZero.sort(), [
    'INVALID_BBOX',
    'INVALID_CATEGORY_REFERENCE',
    'INVALID_IMAGE_DIMENSION',
    'INVALID_IMAGE_REFERENCE',
  ]);
});

// 13. Determinism
test('repeated runs on the same view produce identical issue order and summary', () => {
  const v = view({
    images: [viewImg({ width: 0 })],
    annotations: [viewAnn({ rawId: 10, categoryId: 777 }), viewAnn({ rawId: 11, bbox: [0, 0, 0, 5] })],
  });
  const a = runQaEngine(v);
  const b = runQaEngine(v);
  assert.deepStrictEqual(types(a), types(b));
  assert.deepStrictEqual(a.summary, b.summary);
});

// 14. Descriptor purity
test('descriptors carry no id/qaRunId/createdAt and are not QAIssue instances', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ bbox: [0, 0, 0, 5] })] }));
  const issue = r.issues[0];
  for (const key of ['id', 'qaRunId', 'createdAt']) {
    assert.ok(!(key in issue), key);
  }
  // The descriptor keys are exactly the Step 2 descriptor shape.
  assert.deepStrictEqual(
    Object.keys(issue).sort(),
    ['annotationId', 'categoryId', 'details', 'imageId', 'reason', 'severity', 'type']
  );
});

// 15/16. Input immutability + returned structure frozen
test('the engine does not mutate the input view and returns a frozen structure', () => {
  const v = view({ annotations: [viewAnn({ rawImageId: 999, canonicalImageId: null, canonicalId: null })] });
  const before = JSON.stringify({ images: v.images, annotations: v.annotations, imageIds: [...v.imageIds], categoryIds: [...v.categoryIds] });
  const r = runQaEngine(v);
  const after = JSON.stringify({ images: v.images, annotations: v.annotations, imageIds: [...v.imageIds], categoryIds: [...v.categoryIds] });
  assert.strictEqual(after, before);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.issues));
  assert.ok(Object.isFrozen(r.invalidSets));
  assert.ok(Object.isFrozen(r.summary));
  assert.ok(Object.isFrozen(r.summary.severityCounts));
  assert.ok(Object.isFrozen(r.summary.issueTypeCounts));
});

// 17. All annotations, including would-be-excluded records, are supplied to rules
test('records that have no canonical row are still inspected by the rules', () => {
  // Both annotations have canonicalId null (one dangling image, one unbuildable
  // bbox) — yet both must still produce their QA issue.
  const r = runQaEngine(
    view({
      annotations: [
        viewAnn({ rawId: 10, rawImageId: 999, canonicalImageId: null, canonicalId: null }),
        viewAnn({ rawId: 11, canonicalId: null, bbox: [0, 0, -5, 4] }),
      ],
    })
  );
  assert.ok(r.invalidSets.invalidImageReferenceAnnotationIds.has(10));
  assert.ok(r.invalidSets.invalidBBoxAnnotationIds.has(11));
});

// 18. No COCO reparsing — the engine only reads the view (guarded by not
// requiring any parser/normalizer). A structural check on the source.
test('runQaEngine imports only QA vocabulary and the record rules', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/domain/qa/runQaEngine.js'), 'utf8');
  const requires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(requires.sort(), ['./QAVocabulary', './rules/recordRules']);
  // No parser, normalizer, persistence, or application-layer import.
  assert.ok(!/coco|CocoNormalizer|repositories|persistence|QADatasetViewBuilder|application/i.test(requires.join(',')));
});
