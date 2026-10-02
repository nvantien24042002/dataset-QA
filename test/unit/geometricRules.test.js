'use strict';

// Phase 4 — Step 3B-5 unit test: geometric QA rules (SMALL_OBJECT, TRUNCATED,
// OUT_OF_BOUNDS_BBOX). Fabricated rule inputs (eligible annotations + images),
// no engine, no COCO import. The caller is assumed to have already filtered out
// geometry-ineligible annotations (Step 3B-4).

const { test } = require('node:test');
const assert = require('node:assert');
const { ValidationError } = require('../../src/domain/errors');
const {
  checkSmallObjects,
  checkTruncatedObjects,
  checkOutOfBoundsBboxes,
} = require('../../src/domain/qa/rules/geometricRules');

const img = (overrides = {}) => ({ rawId: 1, canonicalId: 'v::img::1', width: 640, height: 480, ...overrides });
const ann = (overrides = {}) => ({
  rawId: 100,
  rawImageId: 1,
  canonicalImageId: 'v::img::1',
  categoryId: 5,
  bbox: [100, 100, 50, 50],
  ...overrides,
});
const IMAGES = [img()];

// --- SMALL_OBJECT ---

test('SMALL_OBJECT: width exactly 20 does not trigger', () => {
  assert.deepStrictEqual(checkSmallObjects([ann({ bbox: [10, 10, 20, 100] })]).issues, []);
});

test('SMALL_OBJECT: width 19.999 → MEDIUM', () => {
  const [issue] = checkSmallObjects([ann({ bbox: [10, 10, 19.999, 100] })]).issues;
  assert.strictEqual(issue.type, 'SMALL_OBJECT');
  assert.strictEqual(issue.severity, 'MEDIUM');
  assert.strictEqual(issue.details.maxSide, 100);
});

test('SMALL_OBJECT: height 19.999 → MEDIUM', () => {
  const [issue] = checkSmallObjects([ann({ bbox: [10, 10, 100, 19.999] })]).issues;
  assert.strictEqual(issue.severity, 'MEDIUM');
});

test('SMALL_OBJECT: both sides < 10 → HIGH', () => {
  const [issue] = checkSmallObjects([ann({ bbox: [10, 10, 9, 8] })]).issues;
  assert.strictEqual(issue.severity, 'HIGH');
  assert.deepStrictEqual({ ...issue.details, bbox: [...issue.details.bbox] }, {
    bbox: [10, 10, 9, 8],
    bboxWidth: 9,
    bboxHeight: 8,
    maxSide: 9,
  });
});

test('SMALL_OBJECT: one side < 10 but max side >= 10 → MEDIUM', () => {
  const [issue] = checkSmallObjects([ann({ bbox: [10, 10, 9, 25] })]).issues; // v1.md §10.2 last row
  assert.strictEqual(issue.severity, 'MEDIUM');
  assert.strictEqual(issue.details.maxSide, 25);
});

test('SMALL_OBJECT: a large valid bbox yields no issue', () => {
  assert.deepStrictEqual(checkSmallObjects([ann({ bbox: [10, 10, 50, 40] })]).issues, []);
});

test('SMALL_OBJECT: raw descriptor ids and no persistence fields', () => {
  const [issue] = checkSmallObjects([ann({ rawId: 7, rawImageId: 3, categoryId: 9, bbox: [0, 0, 5, 5] })]).issues;
  assert.strictEqual(issue.annotationId, 7);
  assert.strictEqual(issue.imageId, 3);
  assert.strictEqual(issue.categoryId, 9);
  for (const k of ['id', 'qaRunId', 'createdAt']) assert.ok(!(k in issue));
});

// --- TRUNCATED (inclusive 5px, image 640x480) ---

const truncated = (bbox) => checkTruncatedObjects([ann({ bbox })], IMAGES).issues;

test('TRUNCATED: exactly 5px / <5px from each edge fires', () => {
  assert.deepStrictEqual(truncated([5, 100, 10, 10])[0].details.touchedBoundaries, ['left']);
  assert.deepStrictEqual(truncated([2, 100, 10, 10])[0].details.touchedBoundaries, ['left']);
  assert.deepStrictEqual(truncated([100, 5, 10, 10])[0].details.touchedBoundaries, ['top']);
  assert.deepStrictEqual(truncated([100, 2, 10, 10])[0].details.touchedBoundaries, ['top']);
  // right: x+w >= 640-5 = 635
  assert.deepStrictEqual(truncated([625, 100, 10, 10])[0].details.touchedBoundaries, ['right']); // 635
  assert.deepStrictEqual(truncated([628, 100, 10, 10])[0].details.touchedBoundaries, ['right']); // 638
  // bottom: y+h >= 480-5 = 475
  assert.deepStrictEqual(truncated([100, 465, 10, 10])[0].details.touchedBoundaries, ['bottom']); // 475
  assert.deepStrictEqual(truncated([100, 468, 10, 10])[0].details.touchedBoundaries, ['bottom']); // 478
});

test('TRUNCATED: an edge-touching bbox (x+w === W) fires but is not OOB', () => {
  assert.deepStrictEqual(truncated([620, 100, 20, 20])[0].details.touchedBoundaries, ['right']); // x+w=640
  assert.deepStrictEqual(checkOutOfBoundsBboxes([ann({ bbox: [620, 100, 20, 20] })], IMAGES).issues, []);
});

test('TRUNCATED: far from all edges → no issue', () => {
  assert.deepStrictEqual(truncated([100, 100, 50, 50]), []);
});

test('TRUNCATED: multiple boundaries → one descriptor, deterministic order', () => {
  const issues = truncated([2, 2, 10, 10]); // left + top
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].severity, 'MEDIUM');
  assert.deepStrictEqual(issues[0].details.touchedBoundaries, ['left', 'top']);
});

test('TRUNCATED: order is always left, top, right, bottom', () => {
  // A tiny image so one bbox touches all four edges.
  const small = [img({ width: 8, height: 8 })];
  const issues = checkTruncatedObjects([ann({ bbox: [0, 0, 8, 8] })], small).issues;
  assert.deepStrictEqual(issues[0].details.touchedBoundaries, ['left', 'top', 'right', 'bottom']);
});

// --- OUT_OF_BOUNDS_BBOX (strict, image 640x480) ---

const oob = (bbox) => checkOutOfBoundsBboxes([ann({ bbox })], IMAGES).issues;

test('OUT_OF_BOUNDS: x<0, y<0, x+w>W, y+h>H each fire HIGH', () => {
  assert.deepStrictEqual(oob([-1, 100, 20, 20])[0].details.exceededEdges, ['left']);
  assert.deepStrictEqual(oob([100, -1, 20, 20])[0].details.exceededEdges, ['top']);
  assert.deepStrictEqual(oob([630, 100, 20, 20])[0].details.exceededEdges, ['right']); // 650>640
  assert.deepStrictEqual(oob([100, 470, 20, 20])[0].details.exceededEdges, ['bottom']); // 490>480
  assert.strictEqual(oob([-1, 100, 20, 20])[0].severity, 'HIGH');
});

test('OUT_OF_BOUNDS: x=0, y=0, x+w=W, y+h=H do NOT fire', () => {
  assert.deepStrictEqual(oob([0, 100, 20, 20]), []);
  assert.deepStrictEqual(oob([100, 0, 20, 20]), []);
  assert.deepStrictEqual(oob([620, 100, 20, 20]), []); // x+w=640
  assert.deepStrictEqual(oob([100, 460, 20, 20]), []); // y+h=480
});

test('OUT_OF_BOUNDS: multiple exceeded edges in deterministic order', () => {
  const issues = oob([-1, -1, 20, 20]); // left + top
  assert.deepStrictEqual(issues[0].details.exceededEdges, ['left', 'top']);
});

// --- Pinned combination examples from the spec ---

test('pinned: [0,0,20,20] → TRUNCATED only (not SMALL, not OOB)', () => {
  assert.deepStrictEqual(checkSmallObjects([ann({ bbox: [0, 0, 20, 20] })]).issues, []);
  assert.strictEqual(truncated([0, 0, 20, 20]).length, 1);
  assert.deepStrictEqual(oob([0, 0, 20, 20]), []);
});

test('pinned: [0,0,19.999,20] → SMALL MEDIUM + TRUNCATED, not OOB', () => {
  assert.strictEqual(checkSmallObjects([ann({ bbox: [0, 0, 19.999, 20] })]).issues[0].severity, 'MEDIUM');
  assert.strictEqual(truncated([0, 0, 19.999, 20]).length, 1);
  assert.deepStrictEqual(oob([0, 0, 19.999, 20]), []);
});

test('pinned: [0,0,9,8] → SMALL HIGH + TRUNCATED, not OOB', () => {
  assert.strictEqual(checkSmallObjects([ann({ bbox: [0, 0, 9, 8] })]).issues[0].severity, 'HIGH');
  assert.strictEqual(truncated([0, 0, 9, 8]).length, 1);
  assert.deepStrictEqual(oob([0, 0, 9, 8]), []);
});

test('pinned: [-1,10,20,20] → OOB + TRUNCATED, not INVALID_BBOX', () => {
  // x=-1 → OOB left; x=-1<=5 → TRUNCATED left. y=10 is NOT within 5px of top.
  assert.deepStrictEqual(oob([-1, 10, 20, 20])[0].details.exceededEdges, ['left']);
  assert.deepStrictEqual(truncated([-1, 10, 20, 20])[0].details.touchedBoundaries, ['left']);
});

test('pinned: [620,100,20,20] on W=640 → TRUNCATED, not OOB', () => {
  assert.deepStrictEqual(truncated([620, 100, 20, 20])[0].details.touchedBoundaries, ['right']);
  assert.deepStrictEqual(oob([620, 100, 20, 20]), []);
});

test('pinned: [621,100,20,20] on W=640 → TRUNCATED + OOB', () => {
  assert.deepStrictEqual(truncated([621, 100, 20, 20])[0].details.touchedBoundaries, ['right']); // 641>=635
  assert.deepStrictEqual(oob([621, 100, 20, 20])[0].details.exceededEdges, ['right']); // 641>640
});

// --- Gating assumptions / category reference ---

test('an invalid category reference does not stop geometry (caller kept it eligible)', () => {
  // categoryId 777 is dangling, but the caller still passed it in → geometry runs.
  const a = ann({ categoryId: 777, bbox: [0, 0, 5, 5] });
  assert.strictEqual(checkSmallObjects([a]).issues.length, 1);
  assert.strictEqual(checkSmallObjects([a]).issues[0].categoryId, 777);
});

test('geometry-ineligible annotations simply are not in the input (caller filters)', () => {
  // Empty input models the caller having filtered everything out.
  assert.deepStrictEqual(checkSmallObjects([]).issues, []);
  assert.deepStrictEqual(checkTruncatedObjects([], IMAGES).issues, []);
  assert.deepStrictEqual(checkOutOfBoundsBboxes([], IMAGES).issues, []);
});

// --- Null bbox ---

test('null/absent bbox is skipped by all three rules', () => {
  const segOnly = ann({ bbox: null });
  const noBbox = ann();
  delete noBbox.bbox;
  for (const a of [segOnly, noBbox]) {
    assert.deepStrictEqual(checkSmallObjects([a]).issues, []);
    assert.deepStrictEqual(checkTruncatedObjects([a], IMAGES).issues, []);
    assert.deepStrictEqual(checkOutOfBoundsBboxes([a], IMAGES).issues, []);
  }
});

// --- Numeric-string coercion ---

test('numeric-string bbox values are coerced, not concatenated', () => {
  const a = ann({ bbox: ['100', '200', '19', '30'] });
  const [small] = checkSmallObjects([a]).issues;
  assert.strictEqual(small.severity, 'MEDIUM'); // w=19<20, max=30
  assert.strictEqual(small.details.bboxWidth, 19); // number, not "19"
  // x+w = 100+19 = 119 (numeric), nowhere near 640; no truncation/OOB
  assert.deepStrictEqual(checkOutOfBoundsBboxes([a], IMAGES).issues, []);
});

test('numeric-string image width/height are coerced for arithmetic', () => {
  const stringDimImg = [img({ width: '640', height: '480' })];
  // x+w = 621+20 = 641 > 640 → OOB (would be false if "640" compared as string)
  const issues = checkOutOfBoundsBboxes([ann({ bbox: [621, 100, 20, 20] })], stringDimImg).issues;
  assert.deepStrictEqual(issues[0].details.exceededEdges, ['right']);
});

// --- Image resolution contract ---

test('an annotation with no resolvable image throws (contract violation, not a finding)', () => {
  const a = ann({ canonicalImageId: 'v::img::missing' });
  assert.throws(() => checkTruncatedObjects([a], IMAGES), ValidationError);
  assert.throws(() => checkOutOfBoundsBboxes([a], IMAGES), ValidationError);
});

// --- Purity / determinism ---

test('rules do not mutate input and are deterministic', () => {
  const a = ann({ bbox: [2, 2, 9, 9] });
  const before = JSON.stringify(a);
  const r1 = checkTruncatedObjects([a], IMAGES).issues;
  const r2 = checkTruncatedObjects([a], IMAGES).issues;
  assert.strictEqual(JSON.stringify(a), before); // input unchanged
  assert.deepStrictEqual(r1[0].details.touchedBoundaries, r2[0].details.touchedBoundaries);
});

test('descriptors and their details/arrays are frozen', () => {
  const [issue] = checkTruncatedObjects([ann({ bbox: [0, 0, 10, 10] })], IMAGES).issues;
  assert.ok(Object.isFrozen(issue));
  assert.ok(Object.isFrozen(issue.details));
  assert.ok(Object.isFrozen(issue.details.touchedBoundaries));
  assert.ok(Object.isFrozen(issue.details.bbox));
});

test('details.bbox preserves the ORIGINAL raw values (including numeric strings)', () => {
  const [issue] = checkSmallObjects([ann({ bbox: ['0', '0', '5', '5'] })]).issues;
  assert.deepStrictEqual([...issue.details.bbox], ['0', '0', '5', '5']); // raw preserved
  assert.strictEqual(issue.details.bboxWidth, 5); // computed value coerced
});

// --- Architecture: imports ---

test('geometricRules.js imports only domain errors and QA vocabulary', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/domain/qa/rules/geometricRules.js'), 'utf8');
  const requires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(requires.sort(), ['../../errors', '../QAVocabulary']);
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/normalizeId/.test(code)); // no second normalization policy
  assert.ok(!/geometry\/|validateBBox|validateGeometry|bbox\.js/i.test(code)); // no Geometry.js QA substitution
});
