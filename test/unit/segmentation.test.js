'use strict';

// Phase 3 — Step 4 unit test: Segmentation (v2.md §5.6.4, §5.6.5). Segmentation
// supports POLYGON and RLE encodings. POLYGON rings reuse the canonical Polygon
// contract (createPolygon, §5.6.3) — there is no separate lenient ring path.
// RLE is preserved as-is (counts not decoded) with a Phase 3 positive-dimension
// structural guard. No QA severity, review decision, or RLE decoding here.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  createSegmentationPolygon,
  createSegmentationRle,
  SegmentationEncoding,
} = require('../../src/domain/geometry/Geometry');

const P = (x, y) => ({ x, y });

// --- POLYGON segmentation: rings follow the canonical Polygon contract ---

test('valid single polygon ring is accepted', () => {
  const s = createSegmentationPolygon([[P(0, 0), P(4, 0), P(0, 3)]]);
  assert.strictEqual(s.encoding, SegmentationEncoding.POLYGON);
  assert.strictEqual(s.polygons.length, 1);
  assert.strictEqual(s.polygons[0].length, 3);
});

test('multiple polygon rings are accepted', () => {
  const s = createSegmentationPolygon([
    [P(0, 0), P(4, 0), P(0, 3)],
    [P(0, 0), P(2, 0), P(2, 2), P(0, 2)],
  ]);
  assert.strictEqual(s.polygons.length, 2);
  assert.strictEqual(s.polygons[0].length, 3);
  assert.strictEqual(s.polygons[1].length, 4);
});

test('polygon ring with fewer than 3 distinct points is rejected', () => {
  assert.throws(() => createSegmentationPolygon([[P(0, 0), P(1, 1)]]), /3 distinct/);
});

test('polygon ring with a consecutive duplicate is rejected', () => {
  assert.throws(
    () => createSegmentationPolygon([[P(0, 0), P(0, 0), P(2, 0), P(2, 2)]]),
    /consecutive duplicate/
  );
});

test('polygon ring trailing first point is canonicalized away', () => {
  // A,B,C,A -> A,B,C (closure endpoint dropped by the canonical contract).
  const s = createSegmentationPolygon([[P(0, 0), P(2, 0), P(2, 2), P(0, 0)]]);
  assert.strictEqual(s.polygons[0].length, 3);
});

test('polygon ring with a non-finite coordinate is rejected', () => {
  assert.throws(
    () => createSegmentationPolygon([[P(0, 0), P(NaN, 0), P(2, 2)]]),
    /finite/
  );
});

test('collinear polygon ring is constructible (semantic degeneracy, not structural)', () => {
  // Zero-area / collinear is a validate() concern, not a construction rejection.
  const s = createSegmentationPolygon([[P(0, 0), P(1, 0), P(2, 0)]]);
  assert.strictEqual(s.polygons[0].length, 3);
});

test('empty ring list is rejected', () => {
  assert.throws(() => createSegmentationPolygon([]), /ring/);
});

// --- RLE segmentation: preserved as-is + Phase 3 positive-dimension guard ---

test('valid RLE dimensions are accepted and size is preserved', () => {
  const s = createSegmentationRle({ size: [20, 10], counts: 'X' });
  assert.strictEqual(s.encoding, SegmentationEncoding.RLE);
  assert.deepStrictEqual([...s.size], [20, 10]);
});

test('RLE with zero height is rejected', () => {
  assert.throws(() => createSegmentationRle({ size: [0, 10], counts: 'X' }), /positive/);
});

test('RLE with zero width is rejected', () => {
  assert.throws(() => createSegmentationRle({ size: [20, 0], counts: 'X' }), /positive/);
});

test('RLE with negative height is rejected', () => {
  assert.throws(() => createSegmentationRle({ size: [-5, 10], counts: 'X' }), /positive/);
});

test('RLE with negative width is rejected', () => {
  assert.throws(() => createSegmentationRle({ size: [20, -5], counts: 'X' }), /positive/);
});

test('RLE string counts are preserved verbatim (not decoded)', () => {
  const s = createSegmentationRle({ size: [4, 4], counts: 'abc' });
  assert.strictEqual(s.counts, 'abc');
});

test('RLE numeric-array counts are preserved (not decoded)', () => {
  const s = createSegmentationRle({ size: [4, 4], counts: [1, 2, 3] });
  assert.deepStrictEqual([...s.counts], [1, 2, 3]);
});

test('RLE rejects arrays with non-number counts', () => {
  assert.throws(() => createSegmentationRle({ size: [4, 4], counts: [1, '2'] }), /only numbers/);
});

test('RLE copies and freezes numeric counts and dimensions', () => {
  const size = [4, 4];
  const counts = [1, 15];
  const s = createSegmentationRle({ size, counts });
  size[0] = 9;
  counts[0] = 9;
  assert.deepStrictEqual([...s.size], [4, 4]);
  assert.deepStrictEqual([...s.counts], [1, 15]);
  assert.ok(Object.isFrozen(s.size));
  assert.ok(Object.isFrozen(s.counts));
});
