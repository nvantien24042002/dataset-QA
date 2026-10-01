'use strict';

// Shared geometry validation-result vocabulary (v2.md §5.6.6). A
// GeometryValidationResult is { status, issues[] } and is produced by the
// non-throwing validate() of a successfully constructed canonical geometry
// object. It carries DERIVED FACTS ONLY — no QA severity, review decision,
// reviewer state, or human judgment (INV-43).
//
// Status meanings (v2.md §5.6.6):
//   VALID       - satisfies structural AND semantic geometry requirements.
//   DEGENERATE  - structurally representable but geometrically degenerate
//                 (e.g. zero-dimension BBox, zero-area / collinear polygon).
//   INVALID     - a validation boundary / runtime operation cannot establish a
//                 valid geometry result (e.g. malformed/undecodable RLE decode).
//                 Structural violations are rejected at construction (INV-44),
//                 so INVALID is not produced for a constructed BBox or Polygon.

const GeometryValidationStatus = Object.freeze({
  VALID: 'VALID',
  DEGENERATE: 'DEGENERATE',
  INVALID: 'INVALID',
});

// Full GeometryIssue vocabulary (v2.md §5.6.6). Codes fall into three origin
// classes (§5.6.8):
//   - Structural (NON_FINITE_COORDINATE, TOO_FEW_POINTS,
//     DUPLICATE_CONSECUTIVE_POINT, INVALID_BBOX_DIMENSION): rejected at the
//     construction boundary (constructor/factory throws, INV-44). They are
//     RESERVED here for a pre-construction validation of raw/untrusted input and
//     are never emitted by validate() on a canonical object.
//   - Semantic (ZERO_AREA, SELF_INTERSECTION): produced by validate() on a
//     constructed canonical object; drive the DEGENERATE status.
//   - Runtime (INVALID_RLE): produced only at the on-demand decode boundary
//     (decodeRle); drives INVALID when a mask cannot be established (INV-46).
const GeometryIssueCode = Object.freeze({
  NON_FINITE_COORDINATE: 'NON_FINITE_COORDINATE',
  TOO_FEW_POINTS: 'TOO_FEW_POINTS',
  DUPLICATE_CONSECUTIVE_POINT: 'DUPLICATE_CONSECUTIVE_POINT',
  ZERO_AREA: 'ZERO_AREA',
  SELF_INTERSECTION: 'SELF_INTERSECTION',
  INVALID_BBOX_DIMENSION: 'INVALID_BBOX_DIMENSION',
  INVALID_RLE: 'INVALID_RLE',
});

// Status precedence helper (v2.md §5.6.6): INVALID > DEGENERATE > VALID. Used to
// aggregate sub-results (polygon rings, bbox + segmentation) into one geometry
// result. An empty input or all-VALID set yields VALID.
const STATUS_RANK = Object.freeze({
  [GeometryValidationStatus.VALID]: 0,
  [GeometryValidationStatus.DEGENERATE]: 1,
  [GeometryValidationStatus.INVALID]: 2,
});

function worstStatus(statuses) {
  let worst = GeometryValidationStatus.VALID;
  for (const status of statuses) {
    if (STATUS_RANK[status] > STATUS_RANK[worst]) worst = status;
  }
  return worst;
}

module.exports = {
  GeometryValidationStatus,
  GeometryIssueCode,
  worstStatus,
};
