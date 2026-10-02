'use strict';

// Geometric QA rules (Phase 4 Step 3B-5; v1.md §10 SMALL_OBJECT, §11 TRUNCATED,
// §16 OUT_OF_BOUNDS_BBOX). Pure domain: no I/O, no persistence, no QAIssue
// construction. Each rule consumes ALREADY-ELIGIBLE annotations (the caller
// applies geometryEligibility.js first) and, for the image-dependent rules, the
// view's images; it returns Step-2-style raw issue descriptors.
//
// These rules compute their OWN conditions and severities on raw, Number()-
// coerced values (v1.md §6.2). They never call Geometry.js validation — V2
// separates geometry FACTS (VALID/DEGENERATE/INVALID) from QA SEMANTICS
// (severity, issue type).
//
// Preconditions the CALLER guarantees (v1.md §29.2 step 3): image reference,
// image dimensions, and bbox are valid for every annotation passed in. These
// rules therefore do NOT re-derive reference/bbox/dimension/category invalidity.
// A valid segmentation-only annotation can still be eligible, so each bbox-based
// rule explicitly skips a null/absent bbox. Descriptors carry RAW ids
// (rawImageId/rawId/categoryId); raw->canonical mapping belongs to persistence.

const { ValidationError } = require('../../errors');
const { QAIssueType, QASeverity } = require('../QAVocabulary');

const hasBbox = (annotation) => annotation.bbox !== undefined && annotation.bbox !== null;

// A bbox/dimension that passed Step 2 may still be a numeric string (v1.md §6.2);
// coerce before arithmetic. Eligibility guarantees finite results here.
const numericBbox = (bbox) => bbox.map(Number);
const rawCopy = (bbox) => Object.freeze([...bbox]);

function geometryDescriptor({ type, severity, annotation, reason, details }) {
  return Object.freeze({
    type,
    severity,
    imageId: annotation.rawImageId,
    annotationId: annotation.rawId,
    categoryId: annotation.categoryId,
    reason,
    details: Object.freeze(details),
  });
}

const frozenIssues = (issues) => Object.freeze({ issues: Object.freeze(issues) });

// Image lookup via the view's resolved canonical identity (opaque — equality
// only, never parsed/constructed/normalized). The caller guarantees an eligible
// annotation resolves to an image; a missing one is a contract violation, not a
// geometry finding.
function imagesByCanonicalId(images) {
  const map = new Map();
  for (const image of images) {
    if (image.canonicalId != null) map.set(image.canonicalId, image);
  }
  return map;
}

function resolveImage(annotation, lookup) {
  const image = annotation.canonicalImageId != null ? lookup.get(annotation.canonicalImageId) : undefined;
  if (!image) {
    throw new ValidationError('Geometry rule received an annotation with no resolvable image', {
      annotationId: annotation.rawId,
    });
  }
  return image;
}

// --- SMALL_OBJECT (v1.md §10) ---

function checkSmallObjects(annotations) {
  const issues = [];
  for (const annotation of annotations) {
    if (!hasBbox(annotation)) continue;
    const [, , w, h] = numericBbox(annotation.bbox);
    if (w < 20 || h < 20) {
      const maxSide = Math.max(w, h);
      const severity = maxSide < 10 ? QASeverity.HIGH : QASeverity.MEDIUM;
      issues.push(
        geometryDescriptor({
          type: QAIssueType.SMALL_OBJECT,
          severity,
          annotation,
          reason:
            `Bounding box is very small (W×H = ${w}×${h}, largest side = ${maxSide}). ` +
            'A tiny object may be a mislabeled annotation or hard for a model; please check.',
          details: { bbox: rawCopy(annotation.bbox), bboxWidth: w, bboxHeight: h, maxSide },
        })
      );
    }
  }
  return frozenIssues(issues);
}

// --- TRUNCATED (v1.md §11) — inclusive 5px threshold ---

function checkTruncatedObjects(annotations, images) {
  const lookup = imagesByCanonicalId(images);
  const issues = [];
  for (const annotation of annotations) {
    if (!hasBbox(annotation)) continue;
    const [x, y, w, h] = numericBbox(annotation.bbox);
    const image = resolveImage(annotation, lookup);
    const imageWidth = Number(image.width);
    const imageHeight = Number(image.height);
    // Deterministic order by construction: left, top, right, bottom.
    const touchedBoundaries = [];
    if (x <= 5) touchedBoundaries.push('left');
    if (y <= 5) touchedBoundaries.push('top');
    if (x + w >= imageWidth - 5) touchedBoundaries.push('right');
    if (y + h >= imageHeight - 5) touchedBoundaries.push('bottom');
    if (touchedBoundaries.length > 0) {
      issues.push(
        geometryDescriptor({
          type: QAIssueType.TRUNCATED,
          severity: QASeverity.MEDIUM,
          annotation,
          reason:
            `Bounding box touches the image edge(s): ${touchedBoundaries.join(', ')} (within 5px). ` +
            'The object may be truncated; please check.',
          details: {
            bbox: rawCopy(annotation.bbox),
            imageWidth: image.width,
            imageHeight: image.height,
            touchedBoundaries: Object.freeze(touchedBoundaries),
          },
        })
      );
    }
  }
  return frozenIssues(issues);
}

// --- OUT_OF_BOUNDS_BBOX (v1.md §16) — strict inequalities ---

function checkOutOfBoundsBboxes(annotations, images) {
  const lookup = imagesByCanonicalId(images);
  const issues = [];
  for (const annotation of annotations) {
    if (!hasBbox(annotation)) continue;
    const [x, y, w, h] = numericBbox(annotation.bbox);
    const image = resolveImage(annotation, lookup);
    const imageWidth = Number(image.width);
    const imageHeight = Number(image.height);
    // Deterministic order by construction: left, top, right, bottom.
    const exceededEdges = [];
    if (x < 0) exceededEdges.push('left');
    if (y < 0) exceededEdges.push('top');
    if (x + w > imageWidth) exceededEdges.push('right');
    if (y + h > imageHeight) exceededEdges.push('bottom');
    if (exceededEdges.length > 0) {
      issues.push(
        geometryDescriptor({
          type: QAIssueType.OUT_OF_BOUNDS_BBOX,
          severity: QASeverity.HIGH,
          annotation,
          reason:
            `Bounding box extends beyond the image edge(s): ${exceededEdges.join(', ')}. ` +
            'The coordinates may be wrong; please check.',
          details: {
            bbox: rawCopy(annotation.bbox),
            imageWidth: image.width,
            imageHeight: image.height,
            exceededEdges: Object.freeze(exceededEdges),
          },
        })
      );
    }
  }
  return frozenIssues(issues);
}

module.exports = { checkSmallObjects, checkTruncatedObjects, checkOutOfBoundsBboxes };
