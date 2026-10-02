'use strict';

// Phase 4 — runQaEngine unit test: record-rule orchestrator (Step 3B-3) plus the
// geometric-rule wiring. Uses FABRICATED QADatasetView objects (no COCO import)
// so the engine is tested in isolation from parsing/normalization. The default
// fixture is geometrically CLEAN (large image, centered mid-size bbox) so the
// record-focused tests assert only record behavior; geometric tests override the
// bbox/image to trigger the geometric rules.

const { test } = require('node:test');
const assert = require('node:assert');
const { runQaEngine } = require('../../src/domain/qa/runQaEngine');

// A minimal valid view: one image, one annotation that references it. The bbox is
// mid-sized and centered on a 640x480 image → no SMALL_OBJECT/TRUNCATED/OOB.
const viewAnn = (overrides = {}) => ({
  rawId: 100,
  canonicalId: 'v::ann::100',
  rawImageId: 1,
  canonicalImageId: 'v::img::1',
  categoryId: 5,
  bbox: [100, 100, 50, 50],
  segmentation: null,
  ...overrides,
});
const viewImg = (overrides = {}) => ({
  rawId: 1,
  canonicalId: 'v::img::1',
  fileName: 'a.png',
  width: 640,
  height: 480,
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

// 2. Dangling image. The lone image is left with no attached annotation, so
// MISSING_ANNOTATION (dataset block, appended last) also fires.
test('dangling image → INVALID_IMAGE_REFERENCE in the image set only', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ rawImageId: 999, canonicalImageId: null, canonicalId: null })] }));
  assert.deepStrictEqual(types(r), ['INVALID_IMAGE_REFERENCE', 'MISSING_ANNOTATION']);
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

// 6. Invalid image dimensions. The image has no annotation, so MISSING_ANNOTATION
// (dataset block) also fires.
test('invalid image dimensions → INVALID_IMAGE_DIMENSION, raw image id in the dimension set', () => {
  const r = runQaEngine(view({ images: [viewImg({ width: 0 })], annotations: [] }));
  assert.deepStrictEqual(types(r), ['INVALID_IMAGE_DIMENSION', 'MISSING_ANNOTATION']);
  assert.ok(r.invalidSets.invalidDimensionImageIds.has(1));
});

// 7. Negative x/y but otherwise valid bbox: NOT INVALID_BBOX. With geometry now
// wired it is instead handled by OUT_OF_BOUNDS_BBOX (and TRUNCATED), never
// INVALID_BBOX.
test('negative x/y with valid size → no INVALID_BBOX (handled as OOB/TRUNCATED)', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ bbox: [-10, -5, 20, 20] })] }));
  assert.ok(!types(r).includes('INVALID_BBOX'));
  assert.strictEqual(r.invalidSets.invalidBBoxAnnotationIds.size, 0);
  assert.ok(types(r).includes('OUT_OF_BOUNDS_BBOX'));
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
  // Order: record block (image-ref, category-ref, bbox, dimension) then the
  // dataset block. Image 2 (dimension-invalid) has no attached annotation, so
  // MISSING_ANNOTATION fires for it.
  assert.deepStrictEqual(types(r), [
    'INVALID_IMAGE_REFERENCE',
    'INVALID_CATEGORY_REFERENCE',
    'INVALID_BBOX',
    'INVALID_IMAGE_DIMENSION',
    'MISSING_ANNOTATION',
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

// 18. The engine orchestrates only domain QA modules (no parser/normalizer/
// persistence/application). Structural check on the source.
test('runQaEngine imports only QA vocabulary, record rules, eligibility, geometric and dataset rules', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/domain/qa/runQaEngine.js'), 'utf8');
  const requires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(requires.sort(), [
    './QAVocabulary',
    './geometryEligibility',
    './rules/datasetRules',
    './rules/geometricRules',
    './rules/recordRules',
  ]);
  // No parser, normalizer, persistence, or application-layer import.
  assert.ok(!/coco|CocoNormalizer|repositories|persistence|QADatasetViewBuilder|application/i.test(requires.join(',')));
});

// --- Geometric-rule wiring (Step 3B-5 wired into the engine) ---

// B. Small annotation → SMALL_OBJECT appears.
test('wiring: a small eligible annotation produces SMALL_OBJECT', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ bbox: [100, 100, 8, 8] })] }));
  assert.deepStrictEqual(types(r), ['SMALL_OBJECT']);
  assert.strictEqual(r.issues[0].severity, 'HIGH'); // max side 8 < 10
});

// C. Near-edge annotation → TRUNCATED appears.
test('wiring: a near-edge eligible annotation produces TRUNCATED', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ bbox: [2, 100, 50, 50] })] }));
  assert.deepStrictEqual(types(r), ['TRUNCATED']);
  assert.deepStrictEqual(r.issues[0].details.touchedBoundaries, ['left']);
});

// D. OOB annotation → OUT_OF_BOUNDS_BBOX appears.
test('wiring: an out-of-bounds eligible annotation produces OUT_OF_BOUNDS_BBOX', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ bbox: [100, 100, 600, 50] })] }));
  // x+w = 700 > 640 → OOB right; also within 5px of right so TRUNCATED too.
  assert.ok(types(r).includes('OUT_OF_BOUNDS_BBOX'));
});

// E. One annotation triggers all three → all three descriptors preserved.
test('wiring: small + truncated + out-of-bounds all coexist for one annotation', () => {
  // Tiny bbox at a negative origin on a small image: w=h=8 (<20, max<10 → SMALL
  // HIGH); x=-1 (<=5 TRUNCATED left, <0 OOB left).
  const r = runQaEngine(
    view({ images: [viewImg({ width: 8, height: 8 })], annotations: [viewAnn({ bbox: [-1, -1, 8, 8] })] })
  );
  assert.deepStrictEqual(types(r), ['SMALL_OBJECT', 'TRUNCATED', 'OUT_OF_BOUNDS_BBOX']);
});

// F. Category-reference-invalid annotation still receives geometric evaluation.
test('wiring: a category-reference-invalid annotation is still evaluated geometrically', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ categoryId: 777, bbox: [100, 100, 8, 8] })] }));
  // Both the record category issue AND the geometric small-object issue appear.
  assert.deepStrictEqual(types(r), ['INVALID_CATEGORY_REFERENCE', 'SMALL_OBJECT']);
});

// G. Image-reference-invalid annotation gets no geometric descriptor. The image
// has no attached annotation (the only one is dangling), so MISSING_ANNOTATION
// also fires.
test('wiring: a dangling-image annotation is excluded from geometry', () => {
  const r = runQaEngine(
    view({ annotations: [viewAnn({ rawImageId: 999, canonicalImageId: null, canonicalId: null, bbox: [0, 0, 8, 8] })] })
  );
  assert.deepStrictEqual(types(r), ['INVALID_IMAGE_REFERENCE', 'MISSING_ANNOTATION']); // no geometry
});

// H. Invalid-bbox annotation gets no geometric descriptor.
test('wiring: an invalid-bbox annotation is excluded from geometry', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ bbox: [0, 0, -5, 8] })] }));
  assert.deepStrictEqual(types(r), ['INVALID_BBOX']); // not also SMALL/TRUNCATED/OOB
});

// I. Invalid-dimension image excludes all its annotations from geometry.
test('wiring: all annotations on a dimension-invalid image are excluded from geometry', () => {
  const r = runQaEngine(
    view({
      images: [viewImg({ rawId: 1, canonicalId: 'v::img::1', width: 0 })],
      annotations: [
        viewAnn({ rawId: 10, bbox: [0, 0, 8, 8] }),
        viewAnn({ rawId: 11, bbox: [2, 2, 8, 8] }),
      ],
    })
  );
  assert.deepStrictEqual(types(r), ['INVALID_IMAGE_DIMENSION']); // one image-level issue, no geometry
});

// J. A different image being dimension-invalid leaves another image's annotation eligible.
test('wiring: a dimension-invalid image does not suppress annotations on a valid image', () => {
  const r = runQaEngine(
    view({
      images: [
        viewImg({ rawId: 1, canonicalId: 'v::img::1', width: 640, height: 480 }),
        viewImg({ rawId: 2, canonicalId: 'v::img::2', width: 0 }),
      ],
      annotations: [viewAnn({ rawId: 10, rawImageId: 1, canonicalImageId: 'v::img::1', bbox: [100, 100, 8, 8] })],
      imageIds: new Set([1, 2]),
    })
  );
  // image 2 → INVALID_IMAGE_DIMENSION; annotation on image 1 → SMALL_OBJECT;
  // image 2 has no attached annotation → MISSING_ANNOTATION (dataset block).
  assert.deepStrictEqual(types(r), ['INVALID_IMAGE_DIMENSION', 'SMALL_OBJECT', 'MISSING_ANNOTATION']);
});

// K. Null bbox → no geometric descriptor; record issues remain.
test('wiring: a null-bbox (segmentation-only) annotation produces no geometric issue', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ bbox: null, segmentation: [[0, 0, 2, 0, 2, 2]] })] }));
  assert.deepStrictEqual([...r.issues], []); // eligible but nothing for bbox rules to measure
});

// L. Numeric-string bbox/dims remain numerically correct through the engine.
test('wiring: numeric-string bbox and image dims compute numerically', () => {
  const r = runQaEngine(
    view({
      images: [viewImg({ width: '640', height: '480' })],
      annotations: [viewAnn({ bbox: ['100', '100', '8', '8'] })],
    })
  );
  assert.deepStrictEqual(types(r), ['SMALL_OBJECT']);
  assert.strictEqual(r.issues[0].details.bboxWidth, 8); // numeric, not "8"
});

// M. Summary includes geometric counts, all keys present, zeros preserved.
test('wiring: summary includes geometric type/severity counts with all keys present', () => {
  const r = runQaEngine(
    view({ images: [viewImg({ width: 8, height: 8 })], annotations: [viewAnn({ bbox: [-1, -1, 8, 8] })] })
  );
  // small HIGH + truncated MEDIUM + oob HIGH
  assert.strictEqual(r.summary.totalIssues, 3);
  assert.strictEqual(r.summary.issueTypeCounts.SMALL_OBJECT, 1);
  assert.strictEqual(r.summary.issueTypeCounts.TRUNCATED, 1);
  assert.strictEqual(r.summary.issueTypeCounts.OUT_OF_BOUNDS_BBOX, 1);
  assert.strictEqual(r.summary.severityCounts.HIGH, 2);
  assert.strictEqual(r.summary.severityCounts.MEDIUM, 1);
  assert.strictEqual(r.summary.issueTypeCounts.MISSING_ANNOTATION, 0); // still present, zero
  assert.strictEqual(Object.keys(r.summary.issueTypeCounts).length, 9);
});

// N. Record-rule regression: the four record issues are unchanged by wiring.
test('wiring: record-level issues are unchanged (regression)', () => {
  const r = runQaEngine(
    view({
      images: [viewImg({ rawId: 1 }), viewImg({ rawId: 2, canonicalId: 'v::img::2', width: 0 })],
      annotations: [
        viewAnn({ rawId: 10, rawImageId: 999, canonicalImageId: null, canonicalId: null }),
        viewAnn({ rawId: 11, categoryId: 777 }),
        viewAnn({ rawId: 12, bbox: [0, 0, 0, 5] }),
      ],
      imageIds: new Set([1, 2]),
    })
  );
  // Record block unchanged by wiring. Image 2 (dimension-invalid) has no attached
  // annotation, so the dataset block appends MISSING_ANNOTATION; the four record
  // issues themselves are unchanged.
  assert.deepStrictEqual(types(r), [
    'INVALID_IMAGE_REFERENCE',
    'INVALID_CATEGORY_REFERENCE',
    'INVALID_BBOX',
    'INVALID_IMAGE_DIMENSION',
    'MISSING_ANNOTATION',
  ]);
});

// O. Deterministic ordering: record block, then geometric block in rule order.
test('wiring: issue order is record block then SMALL_OBJECT, TRUNCATED, OUT_OF_BOUNDS', () => {
  const r = runQaEngine(
    view({
      images: [viewImg({ width: 8, height: 8 })],
      annotations: [
        viewAnn({ rawId: 10, categoryId: 777, bbox: [-1, -1, 8, 8] }), // category ref + all 3 geometric
      ],
    })
  );
  assert.deepStrictEqual(types(r), [
    'INVALID_CATEGORY_REFERENCE', // record block first
    'SMALL_OBJECT',
    'TRUNCATED',
    'OUT_OF_BOUNDS_BBOX',
  ]);
});

// Q. Properly gated eligible input never triggers the geometric image-resolution
// ValidationError (correct gating makes it unreachable; no fallback added).
test('wiring: properly gated input does not throw an image-resolution error', () => {
  assert.doesNotThrow(() =>
    runQaEngine(view({ annotations: [viewAnn({ bbox: [100, 100, 8, 8] })] }))
  );
});

// R. All-ineligible dataset: record issues remain, no geometric issues.
test('wiring: an all-ineligible dataset yields only record issues', () => {
  const r = runQaEngine(
    view({
      annotations: [
        viewAnn({ rawId: 10, rawImageId: 999, canonicalImageId: null, canonicalId: null, bbox: [0, 0, 8, 8] }),
        viewAnn({ rawId: 11, bbox: [0, 0, -5, 8] }),
      ],
    })
  );
  assert.deepStrictEqual(types(r).sort(), ['INVALID_BBOX', 'INVALID_IMAGE_REFERENCE']);
});

// S. Empty view → complete zero-count summary.
test('wiring: an empty view yields no issues and a complete zero-count summary', () => {
  const r = runQaEngine({ images: [], annotations: [], imageIds: new Set(), categoryIds: new Set() });
  assert.deepStrictEqual([...r.issues], []);
  assert.strictEqual(r.summary.totalIssues, 0);
  assert.strictEqual(Object.keys(r.summary.issueTypeCounts).length, 9);
  assert.strictEqual(Object.keys(r.summary.severityCounts).length, 4);
  assert.ok(Object.values(r.summary.issueTypeCounts).every((n) => n === 0));
});

// --- Dataset-level wiring (MISSING_ANNOTATION + CLASS_IMBALANCE through the engine) ---

const CATS = [{ rawId: 1, name: 'car' }, { rawId: 2, name: 'person' }];
// A view whose categoryIds match the supplied category rawIds, so the record
// category-reference rule does not flag these annotations as dangling (that would
// wrongly exclude them from CLASS_IMBALANCE). Images default to one 640x480.
const classView = (annotations, categoryRawIds, images) => ({
  images: images || [viewImg()],
  annotations,
  imageIds: new Set((images || [viewImg()]).map((i) => i.rawId)),
  categoryIds: new Set(categoryRawIds),
});
// N annotations on image 1 for a given categoryId, all with a clean centered bbox
// so no geometric issue fires.
const classAnns = (spec) => {
  let id = 0;
  const out = [];
  for (const [categoryId, n] of spec) {
    for (let i = 0; i < n; i += 1) {
      out.push(viewAnn({ rawId: (id += 1), categoryId, bbox: [100, 100, 50, 50] }));
    }
  }
  return out;
};

// T. MISSING_ANNOTATION fires through the engine for an empty image.
test('dataset wiring: an empty image produces MISSING_ANNOTATION (INFO)', () => {
  const r = runQaEngine(
    view({
      images: [viewImg({ rawId: 1, canonicalId: 'v::img::1' }), viewImg({ rawId: 2, canonicalId: 'v::img::2' })],
      annotations: [viewAnn({ rawImageId: 1, canonicalImageId: 'v::img::1' })],
    })
  );
  const missing = r.issues.filter((i) => i.type === 'MISSING_ANNOTATION');
  assert.strictEqual(missing.length, 1);
  assert.strictEqual(missing[0].imageId, 2);
  assert.strictEqual(missing[0].severity, 'INFO');
});

// U. An invalid-bbox annotation still counts as attached (no MISSING_ANNOTATION).
test('dataset wiring: an invalid-bbox annotation still attaches (no MISSING_ANNOTATION)', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ bbox: [0, 0, -5, 8] })] }));
  assert.ok(!types(r).includes('MISSING_ANNOTATION')); // the image has an attached annotation
  assert.ok(types(r).includes('INVALID_BBOX'));
});

// V. An invalid-category annotation still counts as attached (no MISSING_ANNOTATION).
test('dataset wiring: an invalid-category annotation still attaches (no MISSING_ANNOTATION)', () => {
  const r = runQaEngine(view({ annotations: [viewAnn({ categoryId: 777 })] }), { categories: CATS });
  assert.ok(!types(r).includes('MISSING_ANNOTATION'));
  assert.ok(types(r).includes('INVALID_CATEGORY_REFERENCE'));
});

// W. runQaEngine(view) with no categories emits no CLASS_IMBALANCE.
test('dataset wiring: no categories option → no CLASS_IMBALANCE (backward compatible)', () => {
  const r = runQaEngine(classView(classAnns([[1, 9], [2, 1]]), [1, 2])); // car 90%, no categories option
  assert.ok(!types(r).includes('CLASS_IMBALANCE'));
});

// X. CLASS_IMBALANCE thresholds through the engine.
test('dataset wiring: <=30% emits no CLASS_IMBALANCE', () => {
  const cats = [{ rawId: 1, name: 'car' }, { rawId: 2, name: 'person' }, { rawId: 3, name: 'dog' }, { rawId: 4, name: 'cat' }];
  const r = runQaEngine(
    classView(classAnns([[1, 3], [2, 3], [3, 3], [4, 1]]), [1, 2, 3, 4]), // max 30%
    { categories: cats }
  );
  assert.ok(!types(r).includes('CLASS_IMBALANCE'));
});

test('dataset wiring: >30% and <=50% emits MEDIUM CLASS_IMBALANCE', () => {
  const r = runQaEngine(classView(classAnns([[1, 5], [2, 5]]), [1, 2]), { categories: CATS }); // 50%
  const imbalance = r.issues.find((i) => i.type === 'CLASS_IMBALANCE');
  assert.strictEqual(imbalance.severity, 'MEDIUM');
  assert.strictEqual(imbalance.categoryId, 1); // raw winning id
  assert.strictEqual(imbalance.details.largestClass, 'car'); // name preserved
});

test('dataset wiring: >50% emits HIGH CLASS_IMBALANCE', () => {
  const r = runQaEngine(classView(classAnns([[1, 6], [2, 4]]), [1, 2]), { categories: CATS }); // 60%
  const imbalance = r.issues.find((i) => i.type === 'CLASS_IMBALANCE');
  assert.strictEqual(imbalance.severity, 'HIGH');
});

// Y. Invalid-category annotations are excluded via the engine's own invalidSets.
test('dataset wiring: invalid-category annotations are excluded from CLASS_IMBALANCE via engine invalidSets', () => {
  // 6 car refs point at category_id 999 (unknown) → both INVALID_CATEGORY_REFERENCE
  // and excluded from the distribution, leaving person as the only valid class at
  // 100%. categoryIds carries only the valid ids {1,2}, so 999 is dangling.
  const annotations = [
    ...Array.from({ length: 6 }, (_, i) => viewAnn({ rawId: `c${i}`, categoryId: 999, bbox: [100, 100, 50, 50] })),
    ...Array.from({ length: 4 }, (_, i) => viewAnn({ rawId: `p${i}`, categoryId: 2, bbox: [100, 100, 50, 50] })),
  ];
  const r = runQaEngine(classView(annotations, [1, 2]), { categories: CATS });
  const imbalance = r.issues.find((i) => i.type === 'CLASS_IMBALANCE');
  assert.strictEqual(imbalance.categoryId, 2); // person, not the excluded car refs
  assert.strictEqual(imbalance.details.largestClassPercentage, 100);
  // And those excluded annotations surfaced as INVALID_CATEGORY_REFERENCE.
  assert.strictEqual(r.issues.filter((i) => i.type === 'INVALID_CATEGORY_REFERENCE').length, 6);
});

// Z. At most one CLASS_IMBALANCE, no LOW.
test('dataset wiring: at most one CLASS_IMBALANCE issue and never LOW', () => {
  const r = runQaEngine(classView(classAnns([[1, 8], [2, 2]]), [1, 2]), { categories: CATS });
  assert.strictEqual(r.issues.filter((i) => i.type === 'CLASS_IMBALANCE').length, 1);
  assert.strictEqual(r.summary.severityCounts.LOW, 0);
});

// AA. MISSING_ANNOTATION and CLASS_IMBALANCE fire independently and coexist with
// record/geometric issues; summary counts both; order is record → geometric →
// dataset (MISSING_ANNOTATION before CLASS_IMBALANCE).
test('dataset wiring: both dataset rules coexist with record/geometric issues in deterministic order', () => {
  const r = runQaEngine(
    classView(
      [
        // image 1: 8 car (one tiny → SMALL_OBJECT) + 2 person → car 80% HIGH imbalance
        viewAnn({ rawId: 1, rawImageId: 1, canonicalImageId: 'v::img::1', categoryId: 1, bbox: [100, 100, 8, 8] }),
        ...classAnns([[1, 7], [2, 2]]).map((a, i) => ({ ...a, rawId: 100 + i })),
      ],
      [1, 2],
      [viewImg({ rawId: 1, canonicalId: 'v::img::1' }), viewImg({ rawId: 2, canonicalId: 'v::img::2' })]
    ),
    { categories: CATS }
  );
  // image 2 is empty → MISSING_ANNOTATION; order: geometric SMALL_OBJECT, then
  // dataset MISSING_ANNOTATION, then CLASS_IMBALANCE.
  assert.deepStrictEqual(types(r), ['SMALL_OBJECT', 'MISSING_ANNOTATION', 'CLASS_IMBALANCE']);
  assert.strictEqual(r.summary.issueTypeCounts.SMALL_OBJECT, 1);
  assert.strictEqual(r.summary.issueTypeCounts.MISSING_ANNOTATION, 1);
  assert.strictEqual(r.summary.issueTypeCounts.CLASS_IMBALANCE, 1);
  assert.strictEqual(r.summary.severityCounts.INFO, 1); // the MISSING_ANNOTATION
});

// BB. MISSING_ANNOTATION increments severityCounts.INFO; all keys stay present.
test('dataset wiring: MISSING_ANNOTATION increments INFO and keeps full summary shape', () => {
  const r = runQaEngine(view({ images: [viewImg()], annotations: [] }));
  assert.strictEqual(r.summary.issueTypeCounts.MISSING_ANNOTATION, 1);
  assert.strictEqual(r.summary.severityCounts.INFO, 1);
  assert.strictEqual(Object.keys(r.summary.issueTypeCounts).length, 9);
  assert.strictEqual(Object.keys(r.summary.severityCounts).length, 4);
});

// CC. Determinism across repeated runs with categories supplied.
test('dataset wiring: repeated runs with categories are deterministic', () => {
  const v = classView(classAnns([[1, 5], [2, 5]]), [1, 2]);
  const a = runQaEngine(v, { categories: CATS });
  const b = runQaEngine(v, { categories: CATS });
  assert.deepStrictEqual(types(a), types(b));
  assert.deepStrictEqual(a.summary, b.summary);
});
