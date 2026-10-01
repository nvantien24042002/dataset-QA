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
  hasSelfIntersection,
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

// --- Polygon topology / self-intersection (Step 3, v2.md §5.4, §5.6.3) ---
// hasSelfIntersection() is true iff a pair of NON-ADJACENT edges intersect or
// overlap. Adjacent-edge vertex sharing (including the closing edge and the
// first edge) is normal polygon adjacency, not self-intersection.

// (A) Simple triangle: all edge pairs are adjacent (N: cyclic adjacency) => false.
test('triangle is not self-intersecting', () => {
  assert.strictEqual(hasSelfIntersection(createPolygon([P(0, 0), P(4, 0), P(0, 3)])), false);
});

// (B) Convex rectangle: non-adjacent edges are parallel and disjoint => false.
test('rectangle is not self-intersecting', () => {
  const poly = createPolygon([P(0, 0), P(4, 0), P(4, 4), P(0, 4)]);
  assert.strictEqual(hasSelfIntersection(poly), false);
});

// (C) Concave-but-simple polygon (rectilinear L): no edges cross => false.
test('concave simple polygon is not self-intersecting', () => {
  const poly = createPolygon([P(0, 0), P(4, 0), P(4, 2), P(2, 2), P(2, 4), P(0, 4)]);
  assert.strictEqual(hasSelfIntersection(poly), false);
});

// (D) Adjacent edges share exactly one vertex — never reported as intersection.
test('adjacent edges sharing a vertex are not self-intersection', () => {
  // Every consecutive edge pair shares a vertex; a simple quad stays false.
  const poly = createPolygon([P(0, 0), P(4, 0), P(4, 4), P(0, 4)]);
  assert.strictEqual(hasSelfIntersection(poly), false);
});

// (E) Closing edge collinear with and touching the first edge at P0 only —
// adjacency (E(n-1), E0) is excluded, so this is not self-intersection.
test('closing edge touching first edge at the shared first vertex is not self-intersection', () => {
  // E0 = (0,0)->(2,0) and E3 = (-3,0)->(0,0) are collinear, meeting only at P0.
  const poly = createPolygon([P(0, 0), P(2, 0), P(2, 3), P(-3, 0)]);
  assert.strictEqual(hasSelfIntersection(poly), false);
});

// (F) Bow-tie quadrilateral: E0 and E2 cross => true.
test('bow-tie quadrilateral is self-intersecting', () => {
  const poly = createPolygon([P(0, 0), P(4, 4), P(4, 0), P(0, 4)]);
  assert.strictEqual(hasSelfIntersection(poly), true);
});

// (G) Non-adjacent edges crossing properly (interior crossing) => true.
test('non-adjacent proper crossing is self-intersecting', () => {
  // E1 = (2,0)->(0,2) and E3 = (2,2)->(0,0) cross at (1,1).
  const poly = createPolygon([P(0, 0), P(2, 0), P(0, 2), P(2, 2)]);
  assert.strictEqual(hasSelfIntersection(poly), true);
});

// (H) Non-adjacent edge endpoint touching another edge's interior (T-junction) => true.
test('non-adjacent endpoint touching an edge interior is self-intersecting', () => {
  // E2 = (2,4)->(2,0): its endpoint (2,0) lies on E0 = (0,0)->(4,0). E0 and E2
  // are non-adjacent.
  const poly = createPolygon([P(0, 0), P(4, 0), P(2, 4), P(2, 0)]);
  assert.strictEqual(hasSelfIntersection(poly), true);
});

// (I) Non-adjacent collinear overlapping edges => true.
test('non-adjacent collinear overlapping edges are self-intersecting', () => {
  // E0 = (0,0)->(4,0) and E3 = (2,0)->(1,0) are collinear on y=0 and overlap.
  const poly = createPolygon([P(0, 0), P(4, 0), P(4, 3), P(2, 0), P(1, 0)]);
  assert.strictEqual(hasSelfIntersection(poly), true);
});

// (J) Non-adjacent collinear but disjoint edges => false.
test('non-adjacent collinear disjoint edges are not self-intersecting', () => {
  // Rectangle [0,4]x[0,2] with a rectangular notch cut from the bottom middle.
  // E0 = (0,0)->(1,0) and E4 = (3,0)->(4,0) are collinear on y=0 but disjoint.
  const poly = createPolygon([
    P(0, 0), P(1, 0), P(1, 1), P(3, 1), P(3, 0), P(4, 0), P(4, 2), P(0, 2),
  ]);
  assert.strictEqual(hasSelfIntersection(poly), false);
});

// (K) Non-adjacent parallel disjoint edges => false.
test('non-adjacent parallel disjoint edges are not self-intersecting', () => {
  // Rectangle top/bottom and left/right edges are parallel and never meet.
  const poly = createPolygon([P(0, 0), P(6, 0), P(6, 3), P(0, 3)]);
  assert.strictEqual(hasSelfIntersection(poly), false);
});

// (L) Non-consecutive repeated vertex: construction does not reject; topology
// decides. Here the repeat reuses an edge, so it IS self-intersecting.
test('non-consecutive repeated vertex is decided by topology (true here)', () => {
  // A,B,C,A,B: E0 = A->B and E3 = A->B coincide (non-adjacent) => overlap.
  const poly = createPolygon([P(0, 0), P(4, 0), P(4, 4), P(0, 0), P(4, 0)]);
  assert.strictEqual(hasSelfIntersection(poly), true);
});

// (M) Logical closure equivalence: A,B,C,A canonicalizes to A,B,C and yields the
// same topology result as the explicit A,B,C.
test('logical closure yields the same self-intersection result as explicit closure', () => {
  const closed = createPolygon([P(0, 0), P(4, 0), P(0, 3), P(0, 0)]);
  const open = createPolygon([P(0, 0), P(4, 0), P(0, 3)]);
  assert.strictEqual(hasSelfIntersection(closed), hasSelfIntersection(open));
  assert.strictEqual(hasSelfIntersection(closed), false);
});

// (N) Triangle cyclic adjacency: the closing edge is adjacent to the first edge,
// so a valid triangle is never self-intersecting.
test('triangle closing edge adjacency is not self-intersection', () => {
  assert.strictEqual(hasSelfIntersection(createPolygon([P(1, 1), P(5, 1), P(3, 6)])), false);
});

// Self-intersection is a DEGENERATE semantic signal (v2.md §5.6.6): a
// self-intersecting polygon validates as DEGENERATE with a SELF_INTERSECTION
// issue, never INVALID (INV-45/46). Topology still never changes construction.
test('hasSelfIntersection drives validatePolygon to DEGENERATE/SELF_INTERSECTION', () => {
  const bowtie = createPolygon([P(0, 0), P(4, 4), P(4, 0), P(0, 4)]);
  assert.strictEqual(hasSelfIntersection(bowtie), true);
  const r = validatePolygon(bowtie);
  assert.strictEqual(r.status, GeometryValidationStatus.DEGENERATE);
  assert.ok(r.issues.some((i) => i.code === GeometryIssueCode.SELF_INTERSECTION));
  assert.notStrictEqual(r.status, GeometryValidationStatus.INVALID);
});

// A symmetric bow-tie has zero shoelace area but is NOT collinear, so it must be
// reported as SELF_INTERSECTION, never ZERO_AREA (v2.md §5.6.3 reserves ZERO_AREA
// for genuine collinear degeneracy).
test('symmetric bow-tie is SELF_INTERSECTION, not ZERO_AREA', () => {
  const bowtie = createPolygon([P(0, 0), P(2, 2), P(2, 0), P(0, 2)]);
  const r = validatePolygon(bowtie);
  assert.strictEqual(r.status, GeometryValidationStatus.DEGENERATE);
  const codes = r.issues.map((i) => i.code);
  assert.ok(codes.includes(GeometryIssueCode.SELF_INTERSECTION));
  assert.ok(!codes.includes(GeometryIssueCode.ZERO_AREA));
});
