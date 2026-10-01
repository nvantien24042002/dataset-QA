'use strict';

// Phase 3 — Step 6 unit test: geometry validation aggregation (v2.md §5.6.4,
// §5.6.6, §5.6.8). Covers the issue-code vocabulary, worstStatus precedence,
// segmentation/geometry aggregation, and the RLE-without-decode boundary.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  GeometryValidationStatus,
  GeometryIssueCode,
  worstStatus,
} = require('../../src/domain/geometry/validation');
const {
  createGeometry,
  createSegmentationPolygon,
  createSegmentationRle,
  GeometryType,
} = require('../../src/domain/geometry/Geometry');
const {
  validateSegmentation,
  validateGeometry,
} = require('../../src/domain/geometry/validateGeometry');

const P = (x, y) => ({ x, y });
const TRI = [P(0, 0), P(4, 0), P(0, 3)]; // non-degenerate triangle
const COLLINEAR = [P(0, 0), P(10, 0), P(20, 0)];
const BOWTIE = [P(0, 0), P(4, 4), P(4, 0), P(0, 4)];

// --- GeometryIssueCode vocabulary (v2.md §5.6.6) ---

test('GeometryIssueCode contains the full SSOT vocabulary', () => {
  assert.deepStrictEqual(
    new Set(Object.values(GeometryIssueCode)),
    new Set([
      'NON_FINITE_COORDINATE',
      'TOO_FEW_POINTS',
      'DUPLICATE_CONSECUTIVE_POINT',
      'ZERO_AREA',
      'SELF_INTERSECTION',
      'INVALID_BBOX_DIMENSION',
      'INVALID_RLE',
    ])
  );
});

// --- worstStatus precedence: INVALID > DEGENERATE > VALID ---

test('worstStatus of empty set is VALID', () => {
  assert.strictEqual(worstStatus([]), GeometryValidationStatus.VALID);
});

test('worstStatus prefers DEGENERATE over VALID', () => {
  assert.strictEqual(
    worstStatus([GeometryValidationStatus.VALID, GeometryValidationStatus.DEGENERATE]),
    GeometryValidationStatus.DEGENERATE
  );
});

test('worstStatus prefers INVALID over DEGENERATE and VALID', () => {
  assert.strictEqual(
    worstStatus([
      GeometryValidationStatus.DEGENERATE,
      GeometryValidationStatus.INVALID,
      GeometryValidationStatus.VALID,
    ]),
    GeometryValidationStatus.INVALID
  );
});

// --- validateSegmentation: POLYGON aggregation ---

test('polygon segmentation with all valid rings => VALID', () => {
  const seg = createSegmentationPolygon([TRI, [P(0, 0), P(2, 0), P(2, 2)]]);
  const r = validateSegmentation(seg);
  assert.strictEqual(r.status, GeometryValidationStatus.VALID);
  assert.deepStrictEqual([...r.issues], []);
});

test('polygon segmentation with a collinear ring => DEGENERATE/ZERO_AREA', () => {
  const seg = createSegmentationPolygon([TRI, COLLINEAR]);
  const r = validateSegmentation(seg);
  assert.strictEqual(r.status, GeometryValidationStatus.DEGENERATE);
  assert.ok(r.issues.some((i) => i.code === GeometryIssueCode.ZERO_AREA));
});

test('polygon segmentation with a self-intersecting ring => DEGENERATE/SELF_INTERSECTION', () => {
  const seg = createSegmentationPolygon([TRI, BOWTIE]);
  const r = validateSegmentation(seg);
  assert.strictEqual(r.status, GeometryValidationStatus.DEGENERATE);
  assert.ok(r.issues.some((i) => i.code === GeometryIssueCode.SELF_INTERSECTION));
});

test('polygon segmentation concatenates ring issues in ring order', () => {
  const seg = createSegmentationPolygon([COLLINEAR, BOWTIE]);
  const r = validateSegmentation(seg);
  const codes = r.issues.map((i) => i.code);
  assert.deepStrictEqual(codes, [
    GeometryIssueCode.ZERO_AREA,
    GeometryIssueCode.SELF_INTERSECTION,
  ]);
});

// --- validateSegmentation: RLE contributes VALID WITHOUT decoding ---

test('RLE segmentation (numeric counts) is VALID without decoding', () => {
  const seg = createSegmentationRle({ size: [2, 3], counts: [1, 3, 2] });
  const r = validateSegmentation(seg);
  assert.strictEqual(r.status, GeometryValidationStatus.VALID);
  assert.deepStrictEqual([...r.issues], []);
  assert.ok(!('mask' in seg));
});

test('RLE segmentation (compressed counts) is VALID without decoding', () => {
  const seg = createSegmentationRle({ size: [2, 2], counts: '0120' });
  assert.strictEqual(validateSegmentation(seg).status, GeometryValidationStatus.VALID);
});

test('RLE whose counts would be UNDECODABLE is still structurally VALID (no decode)', () => {
  // counts [1,2] under-covers a 2x2 mask; decodeRle() would yield INVALID, but
  // validateSegmentation()/validateGeometry() must NOT decode (INV-42/46).
  const seg = createSegmentationRle({ size: [2, 2], counts: [1, 2] });
  const r = validateSegmentation(seg);
  assert.strictEqual(r.status, GeometryValidationStatus.VALID);
  assert.notStrictEqual(r.status, GeometryValidationStatus.INVALID);
});

// --- validateGeometry aggregation ---

test('BBOX geometry: positive dims => VALID', () => {
  const g = createGeometry({ type: GeometryType.BBOX, bbox: { x: 0, y: 0, width: 4, height: 2 } });
  assert.strictEqual(validateGeometry(g).status, GeometryValidationStatus.VALID);
});

test('BBOX geometry: zero dimension => DEGENERATE/ZERO_AREA', () => {
  const g = createGeometry({ type: GeometryType.BBOX, bbox: { x: 0, y: 0, width: 0, height: 2 } });
  const r = validateGeometry(g);
  assert.strictEqual(r.status, GeometryValidationStatus.DEGENERATE);
  assert.ok(r.issues.some((i) => i.code === GeometryIssueCode.ZERO_AREA));
});

test('SEGMENTATION geometry (polygon) aggregates ring results', () => {
  const g = createGeometry({
    type: GeometryType.SEGMENTATION,
    segmentation: { encoding: 'POLYGON', polygons: [BOWTIE] },
  });
  const r = validateGeometry(g);
  assert.strictEqual(r.status, GeometryValidationStatus.DEGENERATE);
  assert.ok(r.issues.some((i) => i.code === GeometryIssueCode.SELF_INTERSECTION));
});

test('geometry with both bbox and segmentation combines by precedence', () => {
  // valid bbox + degenerate (collinear) polygon segmentation => DEGENERATE.
  const g = createGeometry({
    type: GeometryType.SEGMENTATION,
    bbox: { x: 0, y: 0, width: 4, height: 2 },
    segmentation: { encoding: 'POLYGON', polygons: [COLLINEAR] },
  });
  const r = validateGeometry(g);
  assert.strictEqual(r.status, GeometryValidationStatus.DEGENERATE);
  assert.ok(r.issues.some((i) => i.code === GeometryIssueCode.ZERO_AREA));
});

test('validateGeometry never decodes an RLE segmentation', () => {
  const g = createGeometry({
    type: GeometryType.SEGMENTATION,
    segmentation: { encoding: 'RLE', size: [2, 2], counts: [1, 2] },
  });
  const r = validateGeometry(g);
  assert.strictEqual(r.status, GeometryValidationStatus.VALID);
  assert.ok(!('mask' in g.segmentation));
});
