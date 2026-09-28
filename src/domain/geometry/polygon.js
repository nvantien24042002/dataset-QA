'use strict';

// Polygon derived geometry and semantic validation (v2.md §5.4, §5.6.3).
// Phase 3 — Step 2.
//
// Operates on the canonical Polygon produced by createPolygon() in Geometry.js
// (a frozen, ordered list of Point2D). It does NOT define a competing
// representation. Canonical coordinates live in IMAGE_PIXEL space and never
// depend on viewer transform or image dimensions (INV-41).
//
// Architectural boundary (v2.md §5.6.8, Decision #9):
//   Constructor protects structure. validate() evaluates geometry semantics.
// Structural invalidity (non-array, non-finite coordinates, consecutive
// duplicates, fewer than 3 distinct points) is rejected at construction
// (INV-44), so a canonical Polygon reaching these functions is structurally
// sound. Semantic validation therefore yields only VALID or DEGENERATE
// (INV-45) and never throws.
//
// Polygon topology (self-intersection / hasSelfIntersection) is Phase 3 Step 3
// and is intentionally NOT implemented here. No QA severity, review decision,
// or image dimensions appear in this module (INV-43).

const { GeometryValidationStatus, GeometryIssueCode } = require('./validation');

// Axis-aligned bounding extents of the polygon vertices: { x, y, x2, y2 } where
// (x, y) is the min corner and (x2, y2) the max corner (v2.md §5.4 getBounds).
function polygonBounds(points) {
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return Object.freeze({ x: minX, y: minY, x2: maxX, y2: maxY });
}

// Shoelace area of the closed polygon (v2.md §5.4 getArea). Collinear / zero-area
// polygons return 0.
function polygonArea(points) {
  const n = points.length;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// Perimeter of the closed polygon, including the closing edge last -> first
// (v2.md §5.4 getPerimeter). Closure is logical; the first point is not repeated.
function polygonPerimeter(points) {
  const n = points.length;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// Semantic validation of an already-constructed canonical Polygon (v2.md
// §5.6.3, §5.6.6). Returns a GeometryValidationResult { status, issues } and
// never throws. Zero-area (collinear) => DEGENERATE with a ZERO_AREA issue;
// otherwise VALID. Structurally malformed polygons cannot reach this function —
// they are rejected by createPolygon() (INV-44).
function validatePolygon(points) {
  if (polygonArea(points) === 0) {
    return Object.freeze({
      status: GeometryValidationStatus.DEGENERATE,
      issues: Object.freeze([Object.freeze({ code: GeometryIssueCode.ZERO_AREA })]),
    });
  }
  return Object.freeze({
    status: GeometryValidationStatus.VALID,
    issues: Object.freeze([]),
  });
}

module.exports = {
  GeometryValidationStatus,
  GeometryIssueCode,
  polygonBounds,
  polygonArea,
  polygonPerimeter,
  validatePolygon,
};
