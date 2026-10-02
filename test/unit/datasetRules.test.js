'use strict';

// Phase 4 — dataset-level QA rules test: MISSING_ANNOTATION and CLASS_IMBALANCE.
// Fabricated QADatasetView objects + plain category metadata (no engine, no COCO
// import). These rules are independent of the geometric cascade.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  checkMissingAnnotations,
  checkClassImbalance,
} = require('../../src/domain/qa/rules/datasetRules');

const viewImg = (overrides = {}) => ({
  rawId: 1,
  canonicalId: 'v::img::1',
  fileName: 'a.png',
  width: 640,
  height: 480,
  ...overrides,
});
const viewAnn = (overrides = {}) => ({
  rawId: 100,
  canonicalId: 'v::ann::100',
  rawImageId: 1,
  canonicalImageId: 'v::img::1',
  categoryId: 1,
  bbox: [10, 10, 20, 20],
  segmentation: null,
  ...overrides,
});
const view = ({ images, annotations } = {}) => ({
  images: images || [viewImg()],
  annotations: annotations || [viewAnn()],
  imageIds: new Set((images || [viewImg()]).map((i) => i.rawId)),
  categoryIds: new Set([1]),
});

const CATEGORIES = [{ rawId: 1, name: 'car' }, { rawId: 2, name: 'person' }];
const classImbalance = (v, invalidCategoryIds = [], categories = CATEGORIES) =>
  checkClassImbalance(v, { invalidCategoryAnnotationIds: new Set(invalidCategoryIds), categories });

// =========================== MISSING_ANNOTATION ===========================

test('MISSING: an image with zero attached annotations yields one INFO issue', () => {
  const r = checkMissingAnnotations(view({ annotations: [] }));
  assert.strictEqual(r.issues.length, 1);
  assert.deepStrictEqual({ ...r.issues[0], details: { ...r.issues[0].details } }, {
    type: 'MISSING_ANNOTATION',
    severity: 'INFO',
    imageId: 1,
    annotationId: null,
    categoryId: null,
    reason: r.issues[0].reason,
    details: { annotationCount: 0 },
  });
  assert.match(r.issues[0].reason, /negative sample/i);
});

test('MISSING: an image with one valid annotation yields no issue', () => {
  assert.deepStrictEqual(checkMissingAnnotations(view()).issues, []);
});

test('MISSING: mixed images report exactly the empty ones, in view order', () => {
  const r = checkMissingAnnotations(
    view({
      images: [
        viewImg({ rawId: 1, canonicalId: 'v::img::1' }),
        viewImg({ rawId: 2, canonicalId: 'v::img::2' }),
        viewImg({ rawId: 3, canonicalId: 'v::img::3' }),
      ],
      annotations: [viewAnn({ rawImageId: 2, canonicalImageId: 'v::img::2' })],
    })
  );
  assert.deepStrictEqual(r.issues.map((i) => i.imageId), [1, 3]); // image 2 has an annotation
});

test('MISSING: an invalid-bbox annotation on a resolved image still counts (not missing)', () => {
  const r = checkMissingAnnotations(view({ annotations: [viewAnn({ bbox: [0, 0, -5, 5] })] }));
  assert.deepStrictEqual(r.issues, []);
});

test('MISSING: an invalid-category annotation on a resolved image still counts (not missing)', () => {
  const r = checkMissingAnnotations(view({ annotations: [viewAnn({ categoryId: 999 })] }));
  assert.deepStrictEqual(r.issues, []);
});

test('MISSING: a dangling-image annotation attaches to nothing → image stays missing', () => {
  const r = checkMissingAnnotations(
    view({ annotations: [viewAnn({ rawImageId: 999, canonicalImageId: null })] })
  );
  assert.deepStrictEqual(r.issues.map((i) => i.imageId), [1]);
});

test('MISSING: raw image id preserved; annotationId/categoryId null; count 0', () => {
  const r = checkMissingAnnotations(view({ images: [viewImg({ rawId: 'img-7' })], annotations: [] }));
  const issue = r.issues[0];
  assert.strictEqual(issue.imageId, 'img-7');
  assert.strictEqual(issue.annotationId, null);
  assert.strictEqual(issue.categoryId, null);
  assert.strictEqual(issue.details.annotationCount, 0);
});

test('MISSING: does not mutate the input view', () => {
  const v = view({ images: [viewImg(), viewImg({ rawId: 2, canonicalId: 'v::img::2' })], annotations: [] });
  const before = JSON.stringify({ images: v.images, annotations: v.annotations });
  checkMissingAnnotations(v);
  assert.strictEqual(JSON.stringify({ images: v.images, annotations: v.annotations }), before);
});

// =========================== CLASS_IMBALANCE ===========================

// Helper: build N annotations for a given categoryId.
const anns = (spec) => {
  let id = 0;
  const out = [];
  for (const [categoryId, n] of spec) {
    for (let i = 0; i < n; i += 1) out.push(viewAnn({ rawId: (id += 1), categoryId }));
  }
  return out;
};

test('CLASS: max class <= 30% yields no issue', () => {
  // 3 of each of car/person/ (+ two more cats via names) → spread; make car 30%.
  // 10 total, car 3 (30%).
  const cats = [{ rawId: 1, name: 'car' }, { rawId: 2, name: 'person' }, { rawId: 3, name: 'dog' }, { rawId: 4, name: 'cat' }];
  const v = view({ annotations: anns([[1, 3], [2, 3], [3, 2], [4, 2]]) });
  assert.deepStrictEqual(classImbalance(v, [], cats).issues, []);
});

test('CLASS: exactly 30% yields no issue', () => {
  const cats = [{ rawId: 1, name: 'car' }, { rawId: 2, name: 'person' }, { rawId: 3, name: 'dog' }, { rawId: 4, name: 'cat' }];
  // 10 total, largest class = 3 = 30% exactly (not > 30).
  const v = view({ annotations: anns([[1, 3], [2, 3], [3, 3], [4, 1]]) });
  assert.deepStrictEqual(classImbalance(v, [], cats).issues, []);
});

test('CLASS: just above 30% → MEDIUM', () => {
  const cats = [{ rawId: 1, name: 'car' }, { rawId: 2, name: 'person' }, { rawId: 3, name: 'dog' }];
  // 100 total, car 31 = 31% > 30, <= 50 → MEDIUM.
  const v = view({ annotations: anns([[1, 31], [2, 35], [3, 34]]) });
  const [issue] = classImbalance(v, [], cats).issues;
  assert.strictEqual(issue.severity, 'MEDIUM');
});

test('CLASS: exactly 50% → MEDIUM (not > 50)', () => {
  const v = view({ annotations: anns([[1, 5], [2, 5]]) }); // car 5/10 = 50%
  const [issue] = classImbalance(v).issues;
  assert.strictEqual(issue.severity, 'MEDIUM');
  assert.strictEqual(issue.details.largestClassPercentage, 50);
});

test('CLASS: just above 50% → HIGH', () => {
  const v = view({ annotations: anns([[1, 6], [2, 4]]) }); // car 6/10 = 60%
  const [issue] = classImbalance(v).issues;
  assert.strictEqual(issue.severity, 'HIGH');
});

test('CLASS: 100% → HIGH', () => {
  const v = view({ annotations: anns([[1, 4]]) });
  const [issue] = classImbalance(v).issues;
  assert.strictEqual(issue.severity, 'HIGH');
  assert.strictEqual(issue.details.largestClassPercentage, 100);
});

test('CLASS: zero valid annotations → no issue', () => {
  assert.deepStrictEqual(classImbalance(view({ annotations: [] })).issues, []);
});

test('CLASS: invalid-category annotations are excluded from count and denominator', () => {
  // 6 car + 4 person, but 4 of the car ones are category-invalid → car 2, person 4,
  // total 6 → person 66.7% HIGH (not car).
  const annotations = [
    ...anns([[1, 6]]).map((a, i) => ({ ...a, rawId: `car${i}` })),
    ...anns([[2, 4]]).map((a, i) => ({ ...a, rawId: `person${i}` })),
  ];
  const invalid = ['car0', 'car1', 'car2', 'car3']; // 4 car annotations dangling-category
  const [issue] = classImbalance(view({ annotations }), invalid).issues;
  assert.strictEqual(issue.categoryId, 2); // person wins
  assert.ok(Math.abs(issue.details.largestClassPercentage - (4 / 6) * 100) < 1e-9);
});

test('CLASS: a category not in metadata does not resolve (excluded)', () => {
  // categoryId 999 is unknown → excluded; only car(2) counts → 100%.
  const annotations = [
    ...anns([[1, 2]]).map((a, i) => ({ ...a, rawId: `c${i}` })),
    { ...viewAnn({ rawId: 'x', categoryId: 999 }) },
  ];
  const [issue] = classImbalance(view({ annotations })).issues;
  assert.strictEqual(issue.categoryId, 1);
  assert.strictEqual(issue.details.largestClassPercentage, 100);
});

test('CLASS: winning raw categoryId and name are preserved', () => {
  const v = view({ annotations: anns([[1, 7], [2, 3]]) });
  const [issue] = classImbalance(v).issues;
  assert.strictEqual(issue.categoryId, 1);
  assert.strictEqual(issue.details.largestClass, 'car');
});

test('CLASS: threshold uses the UNROUNDED percentage (50.04 → HIGH)', () => {
  // 2501 car / 5000 total = 50.02% → HIGH. Build via counts summing to a >50 fraction.
  // 51 car / 100 = 51% HIGH; use a fraction that rounds down to 50.0 but is > 50:
  // 5004 / 10000 = 50.04%.
  const v = view({ annotations: anns([[1, 5004], [2, 4996]]) });
  const [issue] = classImbalance(v).issues;
  assert.strictEqual(issue.severity, 'HIGH'); // 50.04 > 50 even though it displays as 50.0
  assert.ok(issue.details.largestClassPercentage > 50 && issue.details.largestClassPercentage < 50.1);
});

test('CLASS: ties broken by category name A→Z', () => {
  // car and person both 5/10. "car" < "person" → car wins.
  const v = view({ annotations: anns([[1, 5], [2, 5]]) });
  const [issue] = classImbalance(v).issues;
  assert.strictEqual(issue.details.largestClass, 'car');
  assert.strictEqual(issue.categoryId, 1);
});

test('CLASS: tie winner is name-ordered regardless of category id order', () => {
  // zebra (id 1) vs ant (id 2), both 5 → "ant" wins by name even though its id is larger.
  const cats = [{ rawId: 1, name: 'zebra' }, { rawId: 2, name: 'ant' }];
  const v = view({ annotations: anns([[1, 5], [2, 5]]) });
  const [issue] = classImbalance(v, [], cats).issues;
  assert.strictEqual(issue.details.largestClass, 'ant');
  assert.strictEqual(issue.categoryId, 2);
});

test('CLASS: at most one issue', () => {
  const v = view({ annotations: anns([[1, 8], [2, 2]]) });
  assert.strictEqual(classImbalance(v).issues.length, 1);
});

test('CLASS: category ids 1 and "1" group into the same class via normalizeId', () => {
  const annotations = [
    viewAnn({ rawId: 'a', categoryId: 1 }),
    viewAnn({ rawId: 'b', categoryId: '1' }),
    viewAnn({ rawId: 'c', categoryId: '1' }),
    viewAnn({ rawId: 'd', categoryId: 2 }),
  ];
  // car = 3/4 = 75% HIGH (1 and "1" are one class).
  const [issue] = classImbalance(view({ annotations })).issues;
  assert.strictEqual(issue.categoryId, 1);
  assert.strictEqual(issue.details.largestClassPercentage, 75);
});

test('CLASS: a non-numeric category id does not match a numeric category', () => {
  // categoryId "abc" normalizes to "abc", not in metadata → excluded; car(2) = 100%.
  const annotations = [
    viewAnn({ rawId: 'a', categoryId: 1 }),
    viewAnn({ rawId: 'b', categoryId: 1 }),
    viewAnn({ rawId: 'c', categoryId: 'abc' }),
  ];
  const [issue] = classImbalance(view({ annotations })).issues;
  assert.strictEqual(issue.categoryId, 1);
  assert.strictEqual(issue.details.largestClassPercentage, 100);
});

test('CLASS: does not depend on geometry (ineligible-looking bboxes still counted)', () => {
  // All annotations have tiny/edge bboxes; class imbalance ignores geometry entirely.
  const annotations = anns([[1, 9], [2, 1]]).map((a) => ({ ...a, bbox: [0, 0, 1, 1] }));
  const [issue] = classImbalance(view({ annotations })).issues;
  assert.strictEqual(issue.severity, 'HIGH'); // car 90%
});

// =========================== COMBINED / PURITY ===========================

test('MISSING and CLASS_IMBALANCE fire independently on the same view', () => {
  const v = view({
    images: [viewImg({ rawId: 1, canonicalId: 'v::img::1' }), viewImg({ rawId: 2, canonicalId: 'v::img::2' })],
    annotations: anns([[1, 8], [2, 2]]), // all on image 1 → image 2 is missing; car 80% HIGH
  });
  const missing = checkMissingAnnotations(v).issues;
  const imbalance = classImbalance(v).issues;
  assert.deepStrictEqual(missing.map((i) => i.imageId), [2]);
  assert.strictEqual(imbalance[0].type, 'CLASS_IMBALANCE');
});

test('CLASS descriptor carries no persistence/run/review fields', () => {
  const [issue] = classImbalance(view({ annotations: anns([[1, 9], [2, 1]]) })).issues;
  for (const k of ['id', 'qaRunId', 'createdAt', 'reviewer', 'decision', 'status']) {
    assert.ok(!(k in issue), k);
  }
  assert.deepStrictEqual(
    Object.keys(issue).sort(),
    ['annotationId', 'categoryId', 'details', 'imageId', 'reason', 'severity', 'type']
  );
});

test('both rules are deterministic across repeated runs', () => {
  const v = view({ annotations: anns([[1, 5], [2, 5]]) });
  assert.deepStrictEqual(classImbalance(v).issues, classImbalance(v).issues);
  assert.deepStrictEqual(checkMissingAnnotations(v).issues, checkMissingAnnotations(v).issues);
});

test('CLASS does not mutate the view, categories, or invalid set', () => {
  const v = view({ annotations: anns([[1, 6], [2, 4]]) });
  const cats = [{ rawId: 1, name: 'car' }, { rawId: 2, name: 'person' }];
  const invalid = new Set(['nope']);
  const vBefore = JSON.stringify(v.annotations);
  const catsBefore = JSON.stringify(cats);
  checkClassImbalance(v, { invalidCategoryAnnotationIds: invalid, categories: cats });
  assert.strictEqual(JSON.stringify(v.annotations), vBefore);
  assert.strictEqual(JSON.stringify(cats), catsBefore);
  assert.strictEqual(invalid.size, 1);
});

test('rule results are frozen', () => {
  const r = classImbalance(view({ annotations: anns([[1, 9], [2, 1]]) }));
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.issues));
  assert.ok(Object.isFrozen(r.issues[0]));
  assert.ok(Object.isFrozen(r.issues[0].details));
  const m = checkMissingAnnotations(view({ annotations: [] }));
  assert.ok(Object.isFrozen(m));
  assert.ok(Object.isFrozen(m.issues));
  assert.ok(Object.isFrozen(m.issues[0].details));
});

test('datasetRules.js imports only domain errors-free QA vocabulary and references', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/domain/qa/rules/datasetRules.js'), 'utf8');
  const requires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(requires.sort(), ['../../dataset/references', '../QAVocabulary']);
});
