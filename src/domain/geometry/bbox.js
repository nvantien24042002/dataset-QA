'use strict';

// BBox derived values and semantic validation (v2.md §5.3, §5.6.2, §5.6.6).
// Phase 3 — Step 1.
//
// These functions operate on the canonical BBox produced by createBBox() in
// Geometry.js; they do NOT define a competing representation. The canonical
// source of truth remains { x, y, width, height } (INV-37). Derived values
// (x2, y2, area, bounds) are computed on demand and never stored as canonical
// state.
//
// Architectural boundary (v2.md §5.6.8, Decision #9):
//   Constructor protects structure. validate() evaluates geometry semantics.
// Because structural invalidity (non-finite / negative dimensions) is rejected
// at construction (INV-44), a canonical BBox reaching these functions is always
// structurally sound. Semantic validation therefore yields only VALID or
// DEGENERATE (INV-45). INVALID is reserved for a validation boundary / runtime
// operation that cannot establish a valid geometry result, such as decoding
// malformed RLE (INV-46); it is not produced for a constructed BBox.
//
// This module carries no QA severity, review decision, reviewer state, or image
// dimensions (INV-41, INV-43). Out-of-image is a separate concern (v2.md §5.6.7).

const GeometryValidationStatus = Object.freeze({
  VALID: 'VALID',
  DEGENERATE: 'DEGENERATE',
  INVALID: 'INVALID',
});

const GeometryIssueCode = Object.freeze({
  ZERO_AREA: 'ZERO_AREA',
});

// x2 is the EXCLUSIVE right boundary: x2 = x + width (v2.md §5.6.2).
function bboxX2(bbox) {
  return bbox.x + bbox.width;
}

// y2 is the EXCLUSIVE bottom boundary: y2 = y + height (v2.md §5.6.2).
function bboxY2(bbox) {
  return bbox.y + bbox.height;
}

function bboxArea(bbox) {
  return bbox.width * bbox.height;
}

function bboxBounds(bbox) {
  return Object.freeze({
    x: bbox.x,
    y: bbox.y,
    x2: bboxX2(bbox),
    y2: bboxY2(bbox),
  });
}

// Semantic validation of an already-constructed canonical BBox (v2.md §5.6.6).
// Returns a GeometryValidationResult { status, issues } and never throws.
// A zero-width OR zero-height BBox is DEGENERATE (finite, non-negative but has
// zero area); anything else is VALID. Structurally malformed BBoxes cannot
// reach this function — they are rejected by createBBox() (INV-44).
function validateBBox(bbox) {
  const degenerate = bbox.width === 0 || bbox.height === 0;
  if (degenerate) {
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
  bboxX2,
  bboxY2,
  bboxArea,
  bboxBounds,
  validateBBox,
};
