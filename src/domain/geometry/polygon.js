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
// Polygon topology (self-intersection / hasSelfIntersection) is implemented
// below and is consumed by validatePolygon() as a DEGENERATE semantic signal.
// No QA severity, review decision, or image dimensions appear in this module
// (INV-43).

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

// Are all vertices collinear (lie on a single straight line)? A genuinely
// collinear polygon has zero area; this distinguishes it from a self-crossing
// polygon that also sums to zero shoelace area (e.g. a symmetric bow-tie), which
// is NOT collinear. With n >= 3 distinct points guaranteed by construction, the
// polygon is collinear iff every vertex is collinear with the first edge.
function isCollinear(points) {
  const a = points[0];
  let b = null;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].x !== a.x || points[i].y !== a.y) {
      b = points[i];
      break;
    }
  }
  if (b === null) return true;
  for (const c of points) {
    if (orientation(a, b, c) !== 0) return false;
  }
  return true;
}

// Semantic validation of an already-constructed canonical Polygon (v2.md
// §5.6.3, §5.6.6). Returns a GeometryValidationResult { status, issues } and
// never throws. Two semantic degeneracies drive DEGENERATE:
//   - genuine collinearity (all vertices on one line) => ZERO_AREA;
//   - self-intersection on non-adjacent edges => SELF_INTERSECTION. This also
//     covers the symmetric bow-tie, whose shoelace area is 0 but which is NOT
//     collinear, so it is reported as SELF_INTERSECTION rather than ZERO_AREA.
// Otherwise VALID. Structurally malformed polygons cannot reach this function —
// they are rejected by createPolygon() (INV-44), so INVALID is never returned.
function validatePolygon(points) {
  const issues = [];
  if (isCollinear(points)) {
    issues.push(Object.freeze({ code: GeometryIssueCode.ZERO_AREA }));
  }
  if (hasSelfIntersection(points)) {
    issues.push(Object.freeze({ code: GeometryIssueCode.SELF_INTERSECTION }));
  }
  if (issues.length > 0) {
    return Object.freeze({
      status: GeometryValidationStatus.DEGENERATE,
      issues: Object.freeze(issues),
    });
  }
  return Object.freeze({
    status: GeometryValidationStatus.VALID,
    issues: Object.freeze([]),
  });
}

// --- Polygon topology / self-intersection (v2.md §5.4, §5.6.3) — Phase 3 Step 3 ---
//
// Pure, read-only analysis of an already-constructed canonical Polygon. It does
// NOT mutate the polygon or its points, does NOT append a closing point, and
// does NOT build a second representation — logical closure is handled purely by
// index wrap-around: edge E(i) = P(i) -> P((i + 1) % n).
//
// hasSelfIntersection(points) returns true iff at least one pair of NON-ADJACENT
// edges intersects or overlaps. Adjacent edges (sharing a vertex, including the
// closing edge's adjacency to the first edge) are excluded, so normal vertex
// sharing is never reported. No epsilon/tolerance is used — comparisons follow
// the exact-arithmetic convention already used elsewhere in geometry.

// Orientation of the ordered triple (a, b, c): +1 counter-clockwise, -1
// clockwise, 0 collinear. Exact sign of the 2D cross product.
function orientation(a, b, c) {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (v > 0) return 1;
  if (v < 0) return -1;
  return 0;
}

// Assuming a, b, c are collinear, is b within the axis-aligned bounds of segment
// a-c (i.e. on the segment)?
function onSegment(a, b, c) {
  return (
    Math.min(a.x, c.x) <= b.x &&
    b.x <= Math.max(a.x, c.x) &&
    Math.min(a.y, c.y) <= b.y &&
    b.y <= Math.max(a.y, c.y)
  );
}

// Do segments p1-p2 and p3-p4 intersect? Handles proper crossings, endpoint
// touching, and collinear overlap (CLRS segment-intersection predicate).
function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = orientation(p3, p4, p1);
  const d2 = orientation(p3, p4, p2);
  const d3 = orientation(p1, p2, p3);
  const d4 = orientation(p1, p2, p4);

  // Proper crossing: p1/p2 straddle line p3p4 AND p3/p4 straddle line p1p2.
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }

  // Collinear touching / overlap: a zero-orientation endpoint lying on the other
  // segment covers endpoint touching and collinear overlap; collinear-disjoint
  // and parallel-disjoint fall through to false.
  if (d1 === 0 && onSegment(p3, p1, p4)) return true;
  if (d2 === 0 && onSegment(p3, p2, p4)) return true;
  if (d3 === 0 && onSegment(p1, p3, p2)) return true;
  if (d4 === 0 && onSegment(p1, p4, p2)) return true;

  return false;
}

// Are edges E(i) and E(j) (i < j) adjacent, i.e. do they share a polygon vertex?
// j === i + 1 shares P(i+1); (i === 0 && j === n - 1) is the closing edge
// E(n-1) sharing P0 with E0.
function edgesAdjacent(i, j, n) {
  return j === i + 1 || (i === 0 && j === n - 1);
}

function hasSelfIntersection(points) {
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      if (edgesAdjacent(i, j, n)) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

module.exports = {
  GeometryValidationStatus,
  GeometryIssueCode,
  polygonBounds,
  polygonArea,
  polygonPerimeter,
  validatePolygon,
  hasSelfIntersection,
};
