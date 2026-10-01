'use strict';

// Geometry validation aggregation (v2.md §5.6.4, §5.6.6, §5.6.8) — Phase 3
// Step 6. Combines the per-shape semantic validators into one geometry-level
// result using the status precedence INVALID > DEGENERATE > VALID.
//
// Architectural boundary (Decision #9, INV-43/46): these functions are pure,
// non-throwing, and carry DERIVED FACTS ONLY — no QA severity or review
// decision. They evaluate semantics of an ALREADY-constructed canonical object;
// structural violations were rejected at construction (INV-44).
//
// RLE boundary (INV-42, INV-46): validateGeometry()/validateSegmentation() do
// NOT decode RLE. A successfully constructed RLE segmentation is structurally
// sound and contributes VALID. Decoding is an on-demand runtime operation
// (decodeRle in rle.js) and is the SOLE producer of INVALID / INVALID_RLE.

const { SegmentationEncoding } = require('./Geometry');
const { GeometryValidationStatus, worstStatus } = require('./validation');
const { validateBBox } = require('./bbox');
const { validatePolygon } = require('./polygon');

const validResult = () => Object.freeze({
  status: GeometryValidationStatus.VALID,
  issues: Object.freeze([]),
});

// Validate a canonical Segmentation (v2.md §5.6.4). POLYGON: each ring is
// validated and the ring results are aggregated by precedence with issues
// concatenated in ring order. RLE: structurally VALID without decoding (see
// module header).
function validateSegmentation(segmentation) {
  if (segmentation.encoding === SegmentationEncoding.POLYGON) {
    const ringResults = segmentation.polygons.map(validatePolygon);
    const issues = [];
    for (const r of ringResults) issues.push(...r.issues);
    return Object.freeze({
      status: worstStatus(ringResults.map((r) => r.status)),
      issues: Object.freeze(issues),
    });
  }
  if (segmentation.encoding === SegmentationEncoding.RLE) {
    return validResult();
  }
  // Unreachable for a canonical object (createGeometry rejects unknown
  // encodings). Guard defensively rather than silently returning VALID.
  throw new Error(`Unknown segmentation encoding: ${segmentation.encoding}`);
}

// Validate a canonical Geometry (v2.md §5.6.6). Aggregates the BBox result (if
// present) and the Segmentation result (if present) by precedence, concatenating
// issues (bbox first, then segmentation/ring issues). Never decodes RLE.
function validateGeometry(geometry) {
  const subResults = [];
  if (geometry.bbox) subResults.push(validateBBox(geometry.bbox));
  if (geometry.segmentation) subResults.push(validateSegmentation(geometry.segmentation));
  const issues = [];
  for (const r of subResults) issues.push(...r.issues);
  return Object.freeze({
    status: worstStatus(subResults.map((r) => r.status)),
    issues: Object.freeze(issues),
  });
}

module.exports = {
  validateSegmentation,
  validateGeometry,
};
