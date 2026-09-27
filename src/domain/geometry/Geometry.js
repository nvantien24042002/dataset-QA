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

function createBBox({ x, y, width, height }) {
  if (![x, y, width, height].every(isFiniteNum)) {
    throw new ValidationError('BBox requires finite x, y, width, height', { x, y, width, height });
  }
  return Object.freeze({ x, y, width, height });
}

function createPolygonRing(points) {
  if (!Array.isArray(points) || points.length === 0) {
    throw new ValidationError('Polygon ring must be a non-empty array of points');
  }
  return Object.freeze(
    points.map((p) => {
      if (!isFiniteNum(p.x) || !isFiniteNum(p.y)) {
        throw new ValidationError('Point2D requires finite x, y', p);
      }
      return Object.freeze({ x: p.x, y: p.y });
    })
  );
}

function createSegmentationPolygon(polygons) {
  if (!Array.isArray(polygons) || polygons.length === 0) {
    throw new ValidationError('Polygon segmentation requires at least one ring');
  }
  return Object.freeze({
    encoding: SegmentationEncoding.POLYGON,
    polygons: Object.freeze(polygons.map(createPolygonRing)),
  });
}

function createSegmentationRle({ size, counts }) {
  if (!Array.isArray(size) || size.length !== 2 || !size.every(isFiniteNum)) {
    throw new ValidationError('RLE size must be [height, width]', { size });
  }
  if (typeof counts !== 'string' && !Array.isArray(counts)) {
    throw new ValidationError('RLE counts must be a string or a number array', { counts });
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
    segmentation: segmentation || null,
  });
}

module.exports = {
  CoordinateSpace,
  GeometryType,
  SegmentationEncoding,
  createBBox,
  createPolygonRing,
  createSegmentationPolygon,
  createSegmentationRle,
  createGeometry,
};
