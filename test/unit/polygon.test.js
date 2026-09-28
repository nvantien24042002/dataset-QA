'use strict';

// Phase 3 — Step 2 unit test: Polygon construction, derived geometry, and
// semantic validation (v2.md §5.4, §5.6.3, §5.6.6, §5.6.8). Canonical Polygon is
// an ordered list of Point2D; topology (self-intersection) is Step 3 and is not
// tested here.

const { test } = require('node:test');
const assert = require('node:assert');
const { createPolygon } = require('../../src/domain/geometry/Geometry');
const {
  polygonBounds,
  polygonArea,
  polygonPerimeter,
  validatePolygon,
  GeometryValidationStatus,
  GeometryIssueCode,
} = require('../../src/domain/geometry/polygon');

const P = (x, y) => ({ x, y });

// --- Construction (structural guards, Layer 1 / INV-44) ---

test('createPolygon accepts a valid triangle', () => {
  const poly = createPolygon([P(0, 0), P(4, 0), P(0, 3)]);
  assert.strictEqual(poly.length, 3);
});

test('createPolygon accepts a polygon with 4+ points', () => {
  const poly = createPolygon([P(0, 0), P(4, 0), P(4, 4), P(0, 4)]);
  assert.strictEqual(poly.length, 4);
});

test('createPolygon rejects non-array input', () => {
  assert.throws(() => createPolygon('nope'), /array/);
  assert.throws(() => createPolygon({ points: [] }), /array/);
});

test('createPolygon rejects fewer than 3 distinct points', () => {
  assert.throws(() => createPolygon([P(0, 0), P(1, 1)]), /3 distinct/);
});

test('createPolygon rejects repeated points that yield fewer than 3 distinct', () => {
  // A, B, A (closure drops trailing A) -> A, B -> only 2 distinct.
  assert.throws(() => createPolygon([P(0, 0), P(1, 1), P(0, 0)]), /3 distinct/);
  // A, B, A, B alternating -> 2 distinct.
  assert.throws(() => createPolygon([P(0, 0), P(1, 1), P(0, 0), P(1, 1)]), /distinct|duplicate/);
});

test('createPolygon rejects a malformed point', () => {
  assert.throws(() => createPolygon([P(0, 0), P(4, 0), { x: 1 }]), /finite/);
  assert.throws(() => createPolygon([P(0, 0), P(4, 0), null]), /finite|Cannot/);
});

// --- Coordinates (finite required) ---

test('createPolygon rejects NaN coordinate', () => {
  assert.throws(() => createPolygon([P(0, 0), P(4, 0), P(NaN, 3)]), /finite/);
});

test('createPolygon rejects Infinity coordinate', () => {
  assert.throws(() => createPolygon([P(0, 0), P(4, 0), P(3, Infinity)]), /finite/);
});

test('createPolygon rejects -Infinity coordinate', () => {
  assert.throws(() => createPolygon([P(0, 0), P(-Infinity, 0), P(0, 3)]), /finite/);
});

// --- Consecutive duplicates (v2.md §5.6.3) ---

test('createPolygon rejects consecutive duplicate in the middle (A,B,B,C)', () => {
  assert.throws(
    () => createPolygon([P(0, 0), P(4, 0), P(4, 0), P(0, 3)]),
    /consecutive duplicate/
  );
});

test('createPolygon rejects consecutive duplicate at the beginning (A,A,B,C)', () => {
  assert.throws(
    () => createPolygon([P(0, 0), P(0, 0), P(4, 0), P(0, 3)]),
    /consecutive duplicate/
  );
});

test('createPolygon rejects consecutive duplicate at the end (A,B,C,C)', () => {
  assert.throws(
    () => createPolygon([P(0, 0), P(4, 0), P(0, 3), P(0, 3)]),
    /consecutive duplicate/
  );
});

// --- Logical closure (v2.md §5.6.3) ---

test('A,B,C is accepted without a repeated first point', () => {
  const poly = createPolygon([P(0, 0), P(4, 0), P(0, 3)]);
  assert.strictEqual(poly.length, 3);
});

test('A,B,C,A is allowed and canonicalized to A,B,C (closure endpoint dropped)', () => {
  const poly = createPolygon([P(0, 0), P(4, 0), P(0, 3), P(0, 0)]);
  assert.strictEqual(poly.length, 3);
  assert.deepStrictEqual({ ...poly[0] }, { x: 0, y: 0 });
  assert.deepStrictEqual({ ...poly[2] }, { x: 0, y: 3 });
});

test('non-consecutive repeated points are NOT rejected (ambiguity rule)', () => {
  // A,B,C,A,B: 3 distinct, no consecutive duplicate, last != first. Topology is
  // Step 3; construction must not reject this.
  const poly = createPolygon([P(0, 0), P(4, 0), P(4, 4), P(0, 0), P(4, 0)]);
  assert.strictEqual(poly.length, 5);
});

// --- Semantic validation (Layer 2, VALID / DEGENERATE only) ---

test('non-zero-area triangle => VALID', () => {
  const r = validatePolygon(createPolygon([P(0, 0), P(4, 0), P(0, 3)]));
  assert.strictEqual(r.status, GeometryValidationStatus.VALID);
  assert.deepStrictEqual([...r.issues], []);
});

test('collinear polygon => DEGENERATE with ZERO_AREA', () => {
  const r = validatePolygon(createPolygon([P(0, 0), P(10, 0), P(20, 0)]));
  assert.strictEqual(r.status, GeometryValidationStatus.DEGENERATE);
  assert.strictEqual(r.issues[0].code, GeometryIssueCode.ZERO_AREA);
});

test('zero-area polygon => DEGENERATE', () => {
  // Degenerate "quad" whose vertices are collinear.
  const r = validatePolygon(createPolygon([P(0, 0), P(2, 2), P(4, 4), P(1, 1)]));
  assert.strictEqual(r.status, GeometryValidationStatus.DEGENERATE);
});

test('validatePolygon never returns INVALID for a constructed polygon', () => {
  const r = validatePolygon(createPolygon([P(0, 0), P(4, 0), P(0, 3)]));
  assert.notStrictEqual(r.status, GeometryValidationStatus.INVALID);
});

// --- Derived geometry (v2.md §5.4) ---

test('polygonBounds returns min/max extents { x, y, x2, y2 }', () => {
  const poly = createPolygon([P(1, 2), P(5, 2), P(5, 8), P(1, 8)]);
  assert.deepStrictEqual({ ...polygonBounds(poly) }, { x: 1, y: 2, x2: 5, y2: 8 });
});

test('polygonArea uses the shoelace formula (4x6 rectangle => 24)', () => {
  const poly = createPolygon([P(1, 2), P(5, 2), P(5, 8), P(1, 8)]);
  assert.strictEqual(polygonArea(poly), 24);
});

test('polygonArea of a right triangle (legs 4 and 3) => 6', () => {
  assert.strictEqual(polygonArea(createPolygon([P(0, 0), P(4, 0), P(0, 3)])), 6);
});

test('polygonPerimeter includes the closing edge (4x6 rectangle => 20)', () => {
  const poly = createPolygon([P(1, 2), P(5, 2), P(5, 8), P(1, 8)]);
  assert.strictEqual(polygonPerimeter(poly), 20);
});

test('polygonPerimeter of a 3-4-5 right triangle => 12', () => {
  assert.strictEqual(polygonPerimeter(createPolygon([P(0, 0), P(4, 0), P(0, 3)])), 12);
});

// --- Immutability (matches existing geometry objects) ---

test('a constructed polygon and its points are frozen', () => {
  const poly = createPolygon([P(0, 0), P(4, 0), P(0, 3)]);
  assert.strictEqual(Object.isFrozen(poly), true);
  assert.strictEqual(Object.isFrozen(poly[0]), true);
});
