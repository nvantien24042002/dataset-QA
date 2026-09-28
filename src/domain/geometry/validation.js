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

const GeometryIssueCode = Object.freeze({
  ZERO_AREA: 'ZERO_AREA',
});

module.exports = {
  GeometryValidationStatus,
  GeometryIssueCode,
};
