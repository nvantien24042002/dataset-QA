'use strict';

// Phase 4 — Step 2 unit test: record-level QA rules (v1.md §13, §14, §15, §16B).

const { test } = require('node:test');
const assert = require('node:assert');
const { ValidationError } = require('../../src/domain/errors');
const {
  BBoxProblem,
  DimensionProblem,
  findBBoxProblem,
  findDimensionProblem,
  checkImageReferences,
  checkCategoryReferences,
  checkBBoxes,
  checkImageDimensions,
} = require('../../src/domain/qa/rules/recordRules');
const { normalizeId } = require('../../src/domain/dataset/references');

const ann = (overrides = {}) => ({
  id: 'ann-1',
  imageId: 'img-1',
  categoryId: 1,
  bbox: [10, 10, 20, 20],
  ...overrides,
});
const IMAGES = new Set(['img-1', 'img-2']);
const CATEGORIES = new Set([1, 2]);

// --- ID normalization (v1.md §6.4) ---

test('normalizeId compares numeric-looking ids as numbers, leaves others as-is', () => {
  assert.strictEqual(normalizeId(1), 1);
  assert.strictEqual(normalizeId('1'), 1);
  assert.strictEqual(normalizeId('  1 '), 1); // Number() tolerates surrounding whitespace
  assert.strictEqual(normalizeId('abc'), 'abc'); // non-numeric string unchanged
  assert.strictEqual(normalizeId('ver::img::1'), 'ver::img::1'); // canonical TEXT id unchanged
  assert.strictEqual(normalizeId(''), '');
  assert.strictEqual(normalizeId(null), null);
});

test('image reference matching normalizes both sides: 1 and "1" match', () => {
  // Map keyed by numeric id; annotation refers by string.
  const r = checkImageReferences([ann({ imageId: '1' })], new Map([[1, {}]]));
  assert.deepStrictEqual([...r.issues], []);
  // Set of string ids; annotation refers by number.
  const r2 = checkImageReferences([ann({ imageId: 1 })], new Set(['1']));
  assert.deepStrictEqual([...r2.issues], []);
});

test('category reference matching normalizes both sides: category 1 and "1" match', () => {
  const r = checkCategoryReferences([ann({ categoryId: '1' })], new Set([1]));
  assert.deepStrictEqual([...r.issues], []);
  const r2 = checkCategoryReferences([ann({ categoryId: 1 })], new Map([['1', {}]]));
  assert.deepStrictEqual([...r2.issues], []);
});

test('a non-numeric id ("abc") stays dangling under normalization', () => {
  assert.strictEqual(checkImageReferences([ann({ imageId: 'abc' })], new Set([1, 2])).issues.length, 1);
  assert.strictEqual(checkCategoryReferences([ann({ categoryId: 'abc' })], new Set([1, 2])).issues.length, 1);
});

test('normalization is applied to map keys and references alike (no false dangling)', () => {
  // Keys are strings, references are numbers, and vice-versa — none should be flagged.
  const annotations = [ann({ id: 'a1', imageId: 2, categoryId: '2' }), ann({ id: 'a2', imageId: '2', categoryId: 2 })];
  const imgResult = checkImageReferences(annotations, new Map([['2', {}]]));
  const catResult = checkCategoryReferences(annotations, new Set(['2']));
  assert.deepStrictEqual([...imgResult.issues], []);
  assert.deepStrictEqual([...catResult.issues], []);
});

// --- INVALID_IMAGE_REFERENCE ---

test('INVALID_IMAGE_REFERENCE: a valid reference yields no issue', () => {
  const r = checkImageReferences([ann()], IMAGES);
  assert.deepStrictEqual([...r.issues], []);
  assert.deepStrictEqual([...r.invalidAnnotationIds], []);
});

test('INVALID_IMAGE_REFERENCE: a dangling reference yields one HIGH issue with null imageId', () => {
  const r = checkImageReferences([ann({ id: 'ann-7', imageId: 'img-999', categoryId: 2 })], IMAGES);
  assert.strictEqual(r.issues.length, 1);
  const issue = r.issues[0];
  assert.deepStrictEqual({ ...issue, details: { ...issue.details } }, {
    type: 'INVALID_IMAGE_REFERENCE',
    severity: 'HIGH',
    // null, not 'img-999': the id is dangling, so there is no images.id FK to
    // point at (schema: qa_issues.image_id is a nullable FK). The raw value is
    // kept in details.referencedImageId.
    imageId: null,
    annotationId: 'ann-7',
    categoryId: 2,
    reason: issue.reason,
    details: { referencedImageId: 'img-999' },
  });
  assert.match(issue.reason, /image_id="img-999"/);
  assert.deepStrictEqual([...r.invalidAnnotationIds], ['ann-7']);
});

test('INVALID_IMAGE_REFERENCE: every dangling annotation is reported, in input order', () => {
  const r = checkImageReferences(
    [
      ann({ id: 'a1', imageId: 'x1' }),
      ann({ id: 'a2', imageId: 'img-1' }), // valid, between two dangling ones
      ann({ id: 'a3', imageId: 'x3' }),
    ],
    IMAGES
  );
  assert.deepStrictEqual(r.issues.map((i) => i.annotationId), ['a1', 'a3']);
  assert.deepStrictEqual(r.issues.map((i) => i.details.referencedImageId), ['x1', 'x3']);
  assert.deepStrictEqual(r.issues.map((i) => i.imageId), [null, null]);
  assert.deepStrictEqual([...r.invalidAnnotationIds], ['a1', 'a3']);
});

// --- INVALID_CATEGORY_REFERENCE ---

test('INVALID_CATEGORY_REFERENCE: a valid category yields no issue', () => {
  const r = checkCategoryReferences([ann({ categoryId: 2 })], CATEGORIES);
  assert.deepStrictEqual([...r.issues], []);
  assert.deepStrictEqual([...r.invalidAnnotationIds], []);
});

test('INVALID_CATEGORY_REFERENCE: a dangling category yields one HIGH issue', () => {
  const r = checkCategoryReferences([ann({ id: 'ann-8', imageId: 'img-2', categoryId: 888 })], CATEGORIES);
  assert.strictEqual(r.issues.length, 1);
  const issue = r.issues[0];
  assert.deepStrictEqual({ ...issue, details: { ...issue.details } }, {
    type: 'INVALID_CATEGORY_REFERENCE',
    severity: 'HIGH',
    imageId: 'img-2',
    annotationId: 'ann-8',
    categoryId: 888, // the referenced (dangling) category is preserved, not coerced
    reason: issue.reason,
    details: { referencedCategoryId: 888 },
  });
  assert.match(issue.reason, /category_id=888/);
});

test('INVALID_CATEGORY_REFERENCE: multiple dangling categories are all reported', () => {
  const r = checkCategoryReferences(
    [ann({ id: 'a1', categoryId: 7 }), ann({ id: 'a2', categoryId: 1 }), ann({ id: 'a3', categoryId: 8 })],
    CATEGORIES
  );
  assert.deepStrictEqual(r.issues.map((i) => i.categoryId), [7, 8]);
});

test('INVALID_CATEGORY_REFERENCE: flagged annotations are identifiable for class-distribution exclusion', () => {
  const annotations = [ann({ id: 'a1', categoryId: 1 }), ann({ id: 'a2', categoryId: 99 }), ann({ id: 'a3', categoryId: 2 })];
  const { invalidAnnotationIds } = checkCategoryReferences(annotations, CATEGORIES);
  const excluded = new Set(invalidAnnotationIds);
  const counted = annotations.filter((a) => !excluded.has(a.id)).map((a) => a.id);
  assert.deepStrictEqual(counted, ['a1', 'a3']);
});

test('reference rules are independent: one annotation can be dangling in both', () => {
  const a = [ann({ id: 'a1', imageId: 'x', categoryId: 99 })];
  assert.strictEqual(checkImageReferences(a, IMAGES).issues.length, 1);
  assert.strictEqual(checkCategoryReferences(a, CATEGORIES).issues.length, 1);
});

// --- INVALID_BBOX predicate ---

test('findBBoxProblem: valid bboxes (length-4 boundary, non-integer values)', () => {
  assert.strictEqual(findBBoxProblem([10, 10, 20, 20]), null);
  assert.strictEqual(findBBoxProblem([0, 0, 0.5, 0.5]), null);
});

test('findBBoxProblem: negative x or y is NOT invalid (reserved for OUT_OF_BOUNDS_BBOX)', () => {
  assert.strictEqual(findBBoxProblem([-10, 20, 30, 40]), null);
  assert.strictEqual(findBBoxProblem([10, -20, 30, 40]), null);
  assert.strictEqual(findBBoxProblem([-10, -20, 30, 40]), null);
});

test('findBBoxProblem: wrong shape is malformed', () => {
  assert.strictEqual(findBBoxProblem([10, 10, 20]), BBoxProblem.MALFORMED);
  assert.strictEqual(findBBoxProblem([10, 10, 20, 20, 5]), BBoxProblem.MALFORMED);
  assert.strictEqual(findBBoxProblem([]), BBoxProblem.MALFORMED);
  assert.strictEqual(findBBoxProblem('not-an-array'), BBoxProblem.MALFORMED);
  assert.strictEqual(findBBoxProblem({ x: 1, y: 1, width: 2, height: 2 }), BBoxProblem.MALFORMED);
  assert.strictEqual(findBBoxProblem(42), BBoxProblem.MALFORMED);
});

test('findBBoxProblem: non-finite or non-number elements are non-numeric', () => {
  for (const bbox of [
    [10, 10, NaN, 20],
    [10, 10, Infinity, 20],
    [10, 10, 20, -Infinity],
    [NaN, 10, 20, 20],
    [10, 10, 'abc', 20], // a non-numeric string stays non-numeric
    [10, null, 20, 20],
    [10, 10, 20, undefined],
    [10, true, 20, 20], // a boolean is not a numeric value
    // eslint-disable-next-line no-sparse-arrays
    [10, , 20, 20], // a hole in a sparse array
  ]) {
    assert.strictEqual(findBBoxProblem(bbox), BBoxProblem.NON_NUMERIC, JSON.stringify(bbox));
  }
});

test('findBBoxProblem: coercion is guarded, so Number()-truthy non-numbers stay non-numeric', () => {
  // Raw Number() would make these finite (Number(null)=0, Number(true)=1,
  // Number('')=0, Number('  ')=0); v1.md §15 classes them as "not a number".
  for (const v of [null, true, false, '', '   ']) {
    assert.strictEqual(findBBoxProblem([10, 10, v, 20]), BBoxProblem.NON_NUMERIC, JSON.stringify(v));
  }
});

test('findBBoxProblem: numeric-looking strings are coerced, not flagged (v1.md §6.2)', () => {
  assert.strictEqual(findBBoxProblem([10, 10, '20', '20']), null);
  assert.strictEqual(findBBoxProblem(['-10', 20, 30, 40]), null); // negative x via string is still fine
  assert.strictEqual(findBBoxProblem([10, 10, '0', 20]), BBoxProblem.WIDTH_NOT_POSITIVE);
  assert.strictEqual(findBBoxProblem([10, 10, 20, '-5']), BBoxProblem.HEIGHT_NOT_POSITIVE);
});

test('findBBoxProblem: width <= 0 and height <= 0', () => {
  assert.strictEqual(findBBoxProblem([10, 10, 0, 20]), BBoxProblem.WIDTH_NOT_POSITIVE);
  assert.strictEqual(findBBoxProblem([10, 10, -5, 20]), BBoxProblem.WIDTH_NOT_POSITIVE);
  assert.strictEqual(findBBoxProblem([10, 10, 20, 0]), BBoxProblem.HEIGHT_NOT_POSITIVE);
  assert.strictEqual(findBBoxProblem([10, 10, 20, -5]), BBoxProblem.HEIGHT_NOT_POSITIVE);
});

test('findBBoxProblem: checks run in the v1.md §15 order', () => {
  assert.strictEqual(findBBoxProblem([10, 10, 0]), BBoxProblem.MALFORMED); // shape before value
  assert.strictEqual(findBBoxProblem([10, 10, -5, NaN]), BBoxProblem.NON_NUMERIC); // numeric before size
  assert.strictEqual(findBBoxProblem([10, 10, 0, 0]), BBoxProblem.WIDTH_NOT_POSITIVE); // width before height
});

// --- INVALID_BBOX rule ---

test('INVALID_BBOX: a valid bbox yields no issue', () => {
  const r = checkBBoxes([ann()]);
  assert.deepStrictEqual([...r.issues], []);
  assert.deepStrictEqual([...r.invalidAnnotationIds], []);
});

test('INVALID_BBOX: negative x/y bboxes yield no INVALID_BBOX issue', () => {
  const r = checkBBoxes([ann({ bbox: [-10, 20, 30, 40] }), ann({ id: 'ann-2', bbox: [10, -20, 30, 40] })]);
  assert.deepStrictEqual([...r.issues], []);
});

test('INVALID_BBOX: an invalid bbox yields a HIGH issue with the raw bbox and problem', () => {
  const r = checkBBoxes([ann({ id: 'ann-202', imageId: 'img-1', categoryId: 1, bbox: [10, 10, -5, 40] })]);
  assert.strictEqual(r.issues.length, 1);
  const issue = r.issues[0];
  assert.deepStrictEqual(
    { ...issue, details: { ...issue.details, bbox: [...issue.details.bbox] } },
    {
      type: 'INVALID_BBOX',
      severity: 'HIGH',
      imageId: 'img-1',
      annotationId: 'ann-202',
      categoryId: 1,
      reason: issue.reason,
      details: { bbox: [10, 10, -5, 40], problem: 'width<=0' },
    }
  );
  assert.match(issue.reason, /width = -5 <= 0/);
  assert.deepStrictEqual([...r.invalidAnnotationIds], ['ann-202']);
});

test('INVALID_BBOX: every required example from the spec is flagged with its problem', () => {
  const cases = [
    [[10, 10, 0, 20], 'width<=0'],
    [[10, 10, 20, 0], 'height<=0'],
    [[10, 10, -5, 20], 'width<=0'],
    [[10, 10, 20, -5], 'height<=0'],
    [[10, 10, NaN, 20], 'non-numeric'],
    [[10, 10, 'abc', 20], 'non-numeric'],
    [[10, 10, 20], 'malformed'],
    ['not-an-array', 'malformed'],
  ];
  const r = checkBBoxes(cases.map(([bbox], i) => ann({ id: `a${i}`, bbox })));
  assert.deepStrictEqual(r.issues.map((i) => i.details.problem), cases.map(([, p]) => p));
  assert.deepStrictEqual(r.issues.map((i) => i.details.bbox), cases.map(([b]) => b));
});

test('INVALID_BBOX: an absent bbox (segmentation-only) is not checked by this rule', () => {
  const noBbox = ann({ id: 'a1' });
  delete noBbox.bbox;
  const r = checkBBoxes([noBbox, ann({ id: 'a2', bbox: null })]);
  assert.deepStrictEqual([...r.issues], []);
});

test('INVALID_BBOX: does not stop at the first invalid annotation', () => {
  const r = checkBBoxes([ann({ id: 'a1', bbox: [1, 1, 0, 1] }), ann({ id: 'a2' }), ann({ id: 'a3', bbox: [1] })]);
  assert.deepStrictEqual([...r.invalidAnnotationIds], ['a1', 'a3']);
});

test('INVALID_BBOX: the raw input is neither mutated nor aliased', () => {
  const bbox = [10, 10, -5, 40];
  const input = ann({ bbox });
  const before = JSON.stringify(input);
  const issue = checkBBoxes([input]).issues[0];
  assert.strictEqual(JSON.stringify(input), before);
  assert.notStrictEqual(issue.details.bbox, bbox);
  bbox[2] = 99;
  assert.strictEqual(issue.details.bbox[2], -5);
  assert.ok(Object.isFrozen(issue.details.bbox));
});

// --- INVALID_IMAGE_DIMENSION ---

const img = (overrides = {}) => ({ id: 'img-1', width: 640, height: 480, ...overrides });

test('findDimensionProblem: valid dimensions', () => {
  assert.strictEqual(findDimensionProblem(img()), null);
  assert.strictEqual(findDimensionProblem(img({ width: 1, height: 1 })), null);
});

test('findDimensionProblem: zero, negative, non-finite, and non-number values', () => {
  assert.strictEqual(findDimensionProblem(img({ width: 0 })), DimensionProblem.WIDTH_NOT_POSITIVE);
  assert.strictEqual(findDimensionProblem(img({ height: 0 })), DimensionProblem.HEIGHT_NOT_POSITIVE);
  assert.strictEqual(findDimensionProblem(img({ width: -1 })), DimensionProblem.WIDTH_NOT_POSITIVE);
  assert.strictEqual(findDimensionProblem(img({ height: -1 })), DimensionProblem.HEIGHT_NOT_POSITIVE);
  for (const bad of [NaN, Infinity, -Infinity, 'abc', null, true, {}]) {
    assert.strictEqual(findDimensionProblem(img({ width: bad })), DimensionProblem.NON_NUMERIC, String(bad));
    assert.strictEqual(findDimensionProblem(img({ height: bad })), DimensionProblem.NON_NUMERIC, String(bad));
  }
});

test('findDimensionProblem: numeric-looking strings are coerced (v1.md §6.2)', () => {
  assert.strictEqual(findDimensionProblem(img({ width: '640', height: '480' })), null);
  assert.strictEqual(findDimensionProblem(img({ width: '0' })), DimensionProblem.WIDTH_NOT_POSITIVE);
  assert.strictEqual(findDimensionProblem(img({ height: '-1' })), DimensionProblem.HEIGHT_NOT_POSITIVE);
});

test('findDimensionProblem: coercion is guarded, so Number()-truthy non-numbers stay non-numeric', () => {
  for (const v of [null, true, false, '', '   ']) {
    assert.strictEqual(findDimensionProblem(img({ width: v })), DimensionProblem.NON_NUMERIC, JSON.stringify(v));
  }
});

test('missing width/height is a structural failure, distinct from INVALID_IMAGE_DIMENSION', () => {
  const noWidth = img();
  delete noWidth.width;
  const noHeight = img();
  delete noHeight.height;
  for (const image of [noWidth, noHeight]) {
    assert.throws(() => findDimensionProblem(image), ValidationError);
    assert.throws(() => checkImageDimensions([image]), /structural validation failure/);
  }
});

test('INVALID_IMAGE_DIMENSION: valid images yield no issue', () => {
  const r = checkImageDimensions([img(), img({ id: 'img-2' })]);
  assert.deepStrictEqual([...r.issues], []);
  assert.deepStrictEqual([...r.invalidImageIds], []);
});

test('INVALID_IMAGE_DIMENSION: one image-level HIGH issue per invalid image', () => {
  const r = checkImageDimensions([img({ id: 'img-5', width: 0, height: 480 })]);
  assert.strictEqual(r.issues.length, 1);
  const issue = r.issues[0];
  assert.deepStrictEqual({ ...issue, details: { ...issue.details } }, {
    type: 'INVALID_IMAGE_DIMENSION',
    severity: 'HIGH',
    imageId: 'img-5',
    annotationId: null,
    categoryId: null,
    reason: issue.reason,
    details: { width: 0, height: 480, problem: 'width<=0' },
  });
  assert.match(issue.reason, /width = 0 <= 0/);
  assert.deepStrictEqual([...r.invalidImageIds], ['img-5']);
});

test('INVALID_IMAGE_DIMENSION: an image with both dimensions bad gets one issue', () => {
  const r = checkImageDimensions([img({ width: -1, height: 0 })]);
  assert.strictEqual(r.issues.length, 1);
  assert.strictEqual(r.issues[0].details.problem, 'width<=0');
});

test('INVALID_IMAGE_DIMENSION: NaN and -1 examples, all images processed in order', () => {
  const r = checkImageDimensions([
    img({ id: 'a', width: NaN }),
    img({ id: 'b' }),
    img({ id: 'c', width: -1 }),
  ]);
  assert.deepStrictEqual([...r.invalidImageIds], ['a', 'c']);
  assert.deepStrictEqual(r.issues.map((i) => i.details.problem), ['non-numeric', 'width<=0']);
  assert.ok(Number.isNaN(r.issues[0].details.width)); // raw value preserved
});

// --- Output immutability ---

test('rule results, issue lists, id lists, and descriptors are frozen', () => {
  const results = [
    checkImageReferences([ann({ imageId: 'x' })], IMAGES),
    checkCategoryReferences([ann({ categoryId: 9 })], CATEGORIES),
    checkBBoxes([ann({ bbox: [1, 1, 0, 1] })]),
    checkImageDimensions([img({ width: 0 })]),
  ];
  for (const r of results) {
    assert.ok(Object.isFrozen(r));
    assert.ok(Object.isFrozen(r.issues));
    assert.ok(Object.isFrozen(r.invalidAnnotationIds ?? r.invalidImageIds));
    assert.strictEqual(r.issues.length, 1);
    assert.ok(Object.isFrozen(r.issues[0]));
    assert.ok(Object.isFrozen(r.issues[0].details));
  }
});
