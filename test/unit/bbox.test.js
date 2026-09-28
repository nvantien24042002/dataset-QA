'use strict';

// Phase 3 — Step 1 unit test: BBox construction, derived values, and semantic
// validation (v2.md §5.3, §5.6.2, §5.6.6, §5.6.8). Canonical source of truth is
// { x, y, width, height }; derived values are computed, never stored.

const { test } = require('node:test');
const assert = require('node:assert');
const { createBBox } = require('../../src/domain/geometry/Geometry');
const {
  bboxX2,
  bboxY2,
  bboxArea,
  bboxBounds,
  validateBBox,
  GeometryValidationStatus,
  GeometryIssueCode,
} = require('../../src/domain/geometry/bbox');

// --- Construction (structural guards, Layer 1 / INV-44) ---

test('createBBox accepts a valid positive BBox', () => {
  const b = createBBox({ x: 100, y: 200, width: 80, height: 120 });
  assert.strictEqual(Object.isFrozen(b), true);
});

test('createBBox preserves canonical x, y, width, height', () => {
  const b = createBBox({ x: 100, y: 200, width: 80, height: 120 });
  assert.deepStrictEqual({ ...b }, { x: 100, y: 200, width: 80, height: 120 });
});

test('createBBox rejects non-finite x', () => {
  assert.throws(() => createBBox({ x: NaN, y: 0, width: 1, height: 1 }), /finite/);
});

test('createBBox rejects non-finite y', () => {
  assert.throws(() => createBBox({ x: 0, y: Infinity, width: 1, height: 1 }), /finite/);
});

test('createBBox rejects non-finite width', () => {
  assert.throws(() => createBBox({ x: 0, y: 0, width: NaN, height: 1 }), /finite/);
});

test('createBBox rejects non-finite height', () => {
  assert.throws(() => createBBox({ x: 0, y: 0, width: 1, height: -Infinity }), /finite/);
});

test('createBBox rejects negative width', () => {
  assert.throws(() => createBBox({ x: 0, y: 0, width: -1, height: 1 }), /non-negative/);
});

test('createBBox rejects negative height', () => {
  assert.throws(() => createBBox({ x: 0, y: 0, width: 1, height: -1 }), /non-negative/);
});

// --- Derived values (exclusive boundaries, v2.md §5.6.2) ---

test('bboxX2 = x + width (exclusive right boundary)', () => {
  const b = createBBox({ x: 100, y: 200, width: 80, height: 120 });
  assert.strictEqual(bboxX2(b), 180);
});

test('bboxY2 = y + height (exclusive bottom boundary)', () => {
  const b = createBBox({ x: 100, y: 200, width: 80, height: 120 });
  assert.strictEqual(bboxY2(b), 320);
});

test('bboxArea = width * height', () => {
  const b = createBBox({ x: 0, y: 0, width: 80, height: 120 });
  assert.strictEqual(bboxArea(b), 9600);
});

test('bboxBounds returns { x, y, x2, y2 } with exclusive x2/y2', () => {
  const b = createBBox({ x: 100, y: 200, width: 80, height: 120 });
  assert.deepStrictEqual({ ...bboxBounds(b) }, { x: 100, y: 200, x2: 180, y2: 320 });
});

test('derived values are not stored on the canonical BBox', () => {
  const b = createBBox({ x: 100, y: 200, width: 80, height: 120 });
  assert.deepStrictEqual(Object.keys(b).sort(), ['height', 'width', 'x', 'y']);
});

// --- Semantic validation (Layer 2, VALID / DEGENERATE only) ---

test('positive width and height => VALID', () => {
  const r = validateBBox(createBBox({ x: 0, y: 0, width: 4, height: 4 }));
  assert.strictEqual(r.status, GeometryValidationStatus.VALID);
  assert.deepStrictEqual([...r.issues], []);
});

test('zero width => DEGENERATE', () => {
  const r = validateBBox(createBBox({ x: 0, y: 0, width: 0, height: 4 }));
  assert.strictEqual(r.status, GeometryValidationStatus.DEGENERATE);
});

test('zero height => DEGENERATE', () => {
  const r = validateBBox(createBBox({ x: 0, y: 0, width: 4, height: 0 }));
  assert.strictEqual(r.status, GeometryValidationStatus.DEGENERATE);
});

test('zero width and zero height => DEGENERATE (ZERO_AREA)', () => {
  const r = validateBBox(createBBox({ x: 5, y: 5, width: 0, height: 0 }));
  assert.strictEqual(r.status, GeometryValidationStatus.DEGENERATE);
  assert.strictEqual(r.issues[0].code, GeometryIssueCode.ZERO_AREA);
});

test('validateBBox never returns INVALID for a constructed BBox', () => {
  const r = validateBBox(createBBox({ x: 0, y: 0, width: 1, height: 1 }));
  assert.notStrictEqual(r.status, GeometryValidationStatus.INVALID);
});

// --- Out-of-image is NOT malformed geometry (v2.md §5.6.7, INV-41) ---

test('a BBox extending outside image bounds is still structurally valid', () => {
  // Image dimensions are NOT part of the BBox; a box past the image edge
  // constructs and validates as VALID. Out-of-image is a separate QA concern.
  const b = createBBox({ x: 990, y: 990, width: 50, height: 50 });
  assert.deepStrictEqual(Object.keys(b).sort(), ['height', 'width', 'x', 'y']);
  assert.strictEqual(validateBBox(b).status, GeometryValidationStatus.VALID);
});
