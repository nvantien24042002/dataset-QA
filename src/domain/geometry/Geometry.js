'use strict';

// Canonical 2D geometry data structures (v2.md §5). Coordinates are in
// IMAGE_PIXEL space with a top-left origin (INV-29).
//
// DATA ONLY. Geometric ALGORITHMS — area, perimeter, containsPoint,
// self-intersection, isValid, RLE decoding/rendering — are Phase 3 and are
// intentionally NOT implemented here. This module only defines and shape-checks
// the structures the canonical Annotation needs.

const { ValidationError } = require('../errors');

const CoordinateSpace = Object.freeze({ IMAGE_PIXEL: 'IMAGE_PIXEL' });

const GeometryType = Object.freeze({
  BBOX: 'BBOX',
  POLYGON: 'POLYGON',
  SEGMENTATION: 'SEGMENTATION',
});

const SegmentationEncoding = Object.freeze({
  POLYGON: 'POLYGON',
  RLE: 'RLE',
});

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Point2D — canonical 2D point in IMAGE_PIXEL space (v2.md §5.2, §5.6.1). Data
// only: x and y MUST be finite numbers; NaN / Infinity / -Infinity are rejected
// at construction. A Point2D knows nothing about image dimensions, viewer
// transforms, QA, or persistence.
function createPoint2D({ x, y }) {
  if (!isFiniteNum(x) || !isFiniteNum(y)) {
    throw new ValidationError('Point2D requires finite x, y', { x, y });
  }
  return Object.freeze({ x, y });
}

function createBBox({ x, y, width, height }) {
  if (![x, y, width, height].every(isFiniteNum)) {
    throw new ValidationError('BBox requires finite x, y, width, height', { x, y, width, height });
  }
  // Structural invariant (v2.md §5.6.2, §5.6.8 Layer 1, INV-44): a canonical
  // BBox cannot hold negative dimensions. This is a construction-time structural
  // rejection, not a QA severity or Review decision.
  if (width < 0 || height < 0) {
    throw new ValidationError('BBox width and height must be non-negative', { width, height });
  }
  return Object.freeze({ x, y, width, height });
}

const pointsEqual = (a, b) => a.x === b.x && a.y === b.y;

const countDistinctPoints = (points) => new Set(points.map((p) => `${p.x},${p.y}`)).size;

// Polygon — canonical ordered list of Point2D in IMAGE_PIXEL space (v2.md §5.4,
// §5.6.3). Data + construction-time structural guards only; derived geometry
// (bounds/area/perimeter) and semantic validation live in polygon.js, and
// Polygon topology (self-intersection) is Phase 3 Step 3 (NOT implemented here).
//
// Structural contract (v2.md §5.6.3), all rejected at construction:
//   - input MUST be an array; each point MUST have finite x, y (via Point2D);
//   - consecutive duplicate points (e.g. A,B,B,C) are INVALID structure;
//   - at least 3 DISTINCT points are required (raw length is not sufficient).
// Logical closure: repeating the first point is NOT required. A trailing point
// equal to the first (A,B,C,A) is the ONLY permitted duplicate-endpoint case and
// is canonicalized away to A,B,C. Non-consecutive repeated points are NOT
// rejected here (that is out of the contract; topology is Step 3).
function createPolygon(rawPoints) {
  if (!Array.isArray(rawPoints)) {
    throw new ValidationError('Polygon must be an array of points', { rawPoints });
  }
  const points = rawPoints.map(createPoint2D);
  for (let i = 0; i < points.length - 1; i += 1) {
    if (pointsEqual(points[i], points[i + 1])) {
      throw new ValidationError('Polygon has consecutive duplicate points', { index: i });
    }
  }
  // Canonicalize the logical-closure endpoint: drop a trailing point equal to
  // the first (this is not a consecutive duplicate — the closing edge follows
  // normal polygon adjacency).
  let canonical = points;
  if (points.length >= 2 && pointsEqual(points[0], points[points.length - 1])) {
    canonical = points.slice(0, -1);
  }
  if (countDistinctPoints(canonical) < 3) {
    throw new ValidationError('Polygon requires at least 3 distinct points', {
      distinct: countDistinctPoints(canonical),
    });
  }
  return Object.freeze(canonical);
}

// A segmentation ring IS a canonical Polygon (v2.md §5.6.4 -> §5.6.3): there is
// exactly ONE Polygon contract. This is a backward-compatible alias that
// delegates to createPolygon(); it retains no separate/lenient validation path.
function createPolygonRing(points) {
  return createPolygon(points);
}

function createSegmentationPolygon(polygons) {
  if (!Array.isArray(polygons) || polygons.length === 0) {
    throw new ValidationError('Polygon segmentation requires at least one ring');
  }
  return Object.freeze({
    encoding: SegmentationEncoding.POLYGON,
    polygons: Object.freeze(polygons.map(createPolygon)),
  });
}

function createSegmentationRle({ size, counts }) {
  if (!Array.isArray(size) || size.length !== 2 || !size.every(isFiniteNum)) {
    throw new ValidationError('RLE size must be [height, width]', { size });
  }
  // Phase 3 structural requirement (v2.md §5.6.5): RLE dimensions MUST be
  // positive (height > 0 AND width > 0). Non-positive dimensions are a
  // structural violation rejected at construction (throw), not a validate()
  // result. This does NOT decode counts; undecodable counts remain a runtime
  // INVALID concern.
  if (size[0] <= 0 || size[1] <= 0) {
    throw new ValidationError('RLE dimensions must be positive (height > 0, width > 0)', {
      height: size[0],
      width: size[1],
    });
  }
  if (typeof counts !== 'string' && !Array.isArray(counts)) {
    throw new ValidationError('RLE counts must be a string or a number array', { counts });
  }
  if (Array.isArray(counts) && !counts.every((count) => typeof count === 'number')) {
    throw new ValidationError('RLE counts array must contain only numbers', { counts });
  }
  // RLE semantics are preserved as-is (INV-31). No decoding to a mask or to a
  // polygon happens here — that is Phase 3 rendering work.
  return Object.freeze({
    encoding: SegmentationEncoding.RLE,
    size: Object.freeze([...size]),
    counts: Array.isArray(counts) ? Object.freeze([...counts]) : counts,
  });
}

// Composite geometry attached to an Annotation. `type` is the primary geometry
// kind; `bbox` and/or `segmentation` carry the actual coordinate data. COCO
// annotations often have both a bbox and a segmentation, and §14.3 stores them
// in separate columns (bbox_json, segmentation_json), so the canonical model
// keeps both while naming the primary type.
function createGeometry({ type, bbox = null, segmentation = null }) {
  if (!Object.values(GeometryType).includes(type)) {
    throw new ValidationError('Unknown geometry type', { type });
  }
  return Object.freeze({
    coordinateSpace: CoordinateSpace.IMAGE_PIXEL,
    type,
    bbox: bbox ? createBBox(bbox) : null,
    segmentation: canonicalizeSegmentation(segmentation),
  });
}

function canonicalizeSegmentation(segmentation) {
  if (segmentation === null || segmentation === undefined) return null;
  if (typeof segmentation !== 'object') {
    throw new ValidationError('Segmentation must be an object', { segmentation });
  }
  if (segmentation.encoding === SegmentationEncoding.POLYGON) {
    return createSegmentationPolygon(segmentation.polygons);
  }
  if (segmentation.encoding === SegmentationEncoding.RLE) {
    return createSegmentationRle({ size: segmentation.size, counts: segmentation.counts });
  }
  throw new ValidationError('Unknown segmentation encoding', { encoding: segmentation.encoding });
}

module.exports = {
  CoordinateSpace,
  GeometryType,
  SegmentationEncoding,
  createPoint2D,
  createBBox,
  createPolygon,
  createPolygonRing,
  createSegmentationPolygon,
  createSegmentationRle,
  createGeometry,
};
