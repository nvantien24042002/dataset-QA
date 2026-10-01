'use strict';

// Record-level QA rules (Phase 4 Step 2; v1.md §13, §14, §15, §16B, §29.2 step 2):
// INVALID_IMAGE_REFERENCE, INVALID_CATEGORY_REFERENCE, INVALID_BBOX,
// INVALID_IMAGE_DIMENSION. Pure, deterministic, input-order preserving, no I/O.
//
// INPUT — neutral raw records (not COCO wire shape, not canonical Geometry):
//   AnnotationRecord { id, imageId, categoryId, bbox }
//   ImageRecord      { id, width, height }
// `bbox`, `width`, `height` are the RAW values as read from the source, BEFORE
// canonical construction. INVALID_BBOX exists precisely for values that
// createBBox() rejects (non-finite, negative size, wrong shape), so these rules
// never build a BBox/Geometry and a malformed bbox never becomes canonical
// (v2.md §5.6.6: structural codes may be reported by a pre-construction check of
// raw input). Ids must already be normalized consistently (v1.md §6.4).
//
// OUTPUT — { issues, invalid…Ids } (frozen):
//   - issues: issue descriptors { type, severity, imageId, annotationId,
//     categoryId, reason, details }. The orchestrator (a later step) adds id,
//     qaRunId, datasetVersionId, createdAt and materializes QAIssue; rules invent
//     no ids.
//   - invalidAnnotationIds / invalidImageIds: the flagged records, so the
//     orchestrator can gate geometric rules (v1.md §29.2 step 3) and exclude
//     dangling-category annotations from class distribution (v1.md §14).
// No cascade/gating logic lives here; each rule runs independently.

const { ValidationError } = require('../../errors');
const { QAIssueType, QASeverity } = require('../QAVocabulary');
const { normalizeId } = require('../../dataset/references');

// Deterministic `details.problem` values (v1.md §15, §16B examples).
const BBoxProblem = Object.freeze({
  MALFORMED: 'malformed',
  NON_NUMERIC: 'non-numeric',
  WIDTH_NOT_POSITIVE: 'width<=0',
  HEIGHT_NOT_POSITIVE: 'height<=0',
});

const DimensionProblem = Object.freeze({
  NON_NUMERIC: 'non-numeric',
  WIDTH_NOT_POSITIVE: 'width<=0',
  HEIGHT_NOT_POSITIVE: 'height<=0',
});

// Coerce a bbox/dimension element for detection (v1.md §6.2 Number()
// normalization, reconciled with §15/§16B "not a number -> non-numeric").
//
// GUARDED coercion, NOT raw Number(): Number() would turn non-numeric values
// into finite numbers (Number(null)===0, Number(true)===1, Number('')===0,
// Number('  ')===0), which §15/§16B explicitly class as "not a number". So
// Number() is applied ONLY to a real number (passes through) or a numeric-looking
// non-blank string ("20" -> 20); every other value — null, undefined, boolean,
// object, array, a sparse-array hole, a blank/non-numeric string — is treated as
// non-numeric and yields NaN. The one observable difference from raw Number() is
// confined to those non-numeric inputs, and they are an issue either way (just
// reported as "non-numeric" rather than "width<=0").
//
// Detection-time only: never mutates input and never builds a canonical BBox.
// createBBox() stays strict, so the orchestrator must apply the SAME coercion to
// numeric-looking strings before construction.
function coerceNumeric(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

const isFiniteNumber = (value) => Number.isFinite(value);

const describe = (value) => (typeof value === 'string' ? JSON.stringify(value) : String(value));

// Shallow, frozen copy of a raw value for `details`, so a descriptor never
// aliases (and cannot mutate) the caller's input.
function preserveRaw(value) {
  if (Array.isArray(value)) return Object.freeze([...value]);
  if (value !== null && typeof value === 'object') return Object.freeze({ ...value });
  return value;
}

function issueDescriptor({ type, imageId, annotationId = null, categoryId = null, reason, details }) {
  return Object.freeze({
    type,
    severity: QASeverity.HIGH, // all four record-level rules are fixed HIGH (v1.md §18)
    imageId,
    annotationId,
    categoryId,
    reason,
    details: Object.freeze(details),
  });
}

const result = (issues, idsKey, ids) => Object.freeze({ issues: Object.freeze(issues), [idsKey]: Object.freeze(ids) });

// --- INVALID_BBOX predicate (v1.md §15 isInvalidBbox) ---

// Returns a BBoxProblem, or null when the bbox is value-valid. Elements are
// coerced like the normalized dataset (coerceNumeric), so "20" is valid but
// "abc" is non-numeric. Negative x / y are NOT a problem here: they belong to
// OUT_OF_BOUNDS_BBOX (v1.md §15 note). The width/height comparisons use the
// COERCED values, so "0"/"-5" are detected as non-positive.
function findBBoxProblem(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return BBoxProblem.MALFORMED;
  // Index loop, not every(): every() skips holes in a sparse array.
  const coerced = [];
  for (let i = 0; i < 4; i += 1) {
    coerced[i] = coerceNumeric(bbox[i]);
    if (!isFiniteNumber(coerced[i])) return BBoxProblem.NON_NUMERIC;
  }
  if (coerced[2] <= 0) return BBoxProblem.WIDTH_NOT_POSITIVE;
  if (coerced[3] <= 0) return BBoxProblem.HEIGHT_NOT_POSITIVE;
  return null;
}

// --- INVALID_IMAGE_DIMENSION predicate (v1.md §16B isInvalidDimension) ---

// Returns a DimensionProblem, or null when both dimensions are valid. A MISSING
// width/height (undefined) is a fatal structural condition (v1.md §5 row 6) that
// must be stopped before QA, so it throws instead of becoming this QA issue.
// A present-but-bad value (null, NaN, Infinity, "abc", 0, -1) is the QA issue;
// a numeric-looking string ("640") is coerced and treated as valid (v1.md §6.2).
function findDimensionProblem(image) {
  if (image.width === undefined || image.height === undefined) {
    throw new ValidationError(
      'Image width/height is missing; this is a structural validation failure, not a QA issue',
      { imageId: image.id }
    );
  }
  // Guarded coercion (coerceNumeric), so "640" is valid; "abc", null, boolean,
  // NaN, or Infinity stay non-numeric (not silently 0/1 as raw Number() gives).
  const width = coerceNumeric(image.width);
  const height = coerceNumeric(image.height);
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) {
    return DimensionProblem.NON_NUMERIC;
  }
  if (width <= 0) return DimensionProblem.WIDTH_NOT_POSITIVE;
  if (height <= 0) return DimensionProblem.HEIGHT_NOT_POSITIVE;
  return null;
}

// --- Rules ---

// Build a normalized membership set from a Set of ids or a Map keyed by id
// (v1.md §6.4). Both the set keys and the reference value are normalized the
// same way, so image.id = 1 matches annotation.image_id = "1".
const normalizedKeySet = (ids) => new Set([...ids.keys()].map(normalizeId));

// INVALID_IMAGE_REFERENCE (v1.md §13). `imageIds`: Set or Map keyed by image id.
// The issue's imageId is null: the referenced id is dangling, so it has no
// canonical images.id to point at (schema: qa_issues.image_id is a nullable FK
// to images.id). The raw referenced value is preserved in
// details.referencedImageId for traceability; no Image is manufactured for it.
function checkImageReferences(annotations, imageIds) {
  const keys = normalizedKeySet(imageIds);
  const issues = [];
  const invalidAnnotationIds = [];
  for (const annotation of annotations) {
    if (keys.has(normalizeId(annotation.imageId))) continue;
    invalidAnnotationIds.push(annotation.id);
    issues.push(
      issueDescriptor({
        type: QAIssueType.INVALID_IMAGE_REFERENCE,
        imageId: null,
        annotationId: annotation.id,
        categoryId: annotation.categoryId,
        reason:
          `Annotation references image_id=${describe(annotation.imageId)}, which does not exist ` +
          'in this dataset. The dangling reference should be fixed.',
        details: { referencedImageId: annotation.imageId },
      })
    );
  }
  return result(issues, 'invalidAnnotationIds', invalidAnnotationIds);
}

// INVALID_CATEGORY_REFERENCE (v1.md §14). `categoryIds`: Set or Map keyed by
// category id. The category is never coerced to a valid one; flagged annotations
// must be excluded from class distribution by the caller.
function checkCategoryReferences(annotations, categoryIds) {
  const keys = normalizedKeySet(categoryIds);
  const issues = [];
  const invalidAnnotationIds = [];
  for (const annotation of annotations) {
    if (keys.has(normalizeId(annotation.categoryId))) continue;
    invalidAnnotationIds.push(annotation.id);
    issues.push(
      issueDescriptor({
        type: QAIssueType.INVALID_CATEGORY_REFERENCE,
        // imageId is the annotation's own (resolvable) image; the dangling value
        // is the category, kept as categoryId + details.referencedCategoryId.
        imageId: annotation.imageId,
        annotationId: annotation.id,
        categoryId: annotation.categoryId,
        reason:
          `Annotation references category_id=${describe(annotation.categoryId)}, which does not ` +
          "exist in 'categories'. The dangling reference should be fixed.",
        details: { referencedCategoryId: annotation.categoryId },
      })
    );
  }
  return result(issues, 'invalidAnnotationIds', invalidAnnotationIds);
}

function bboxReason(bbox, problem) {
  switch (problem) {
    case BBoxProblem.MALFORMED:
      return 'Bounding box is malformed (expected an array of 4 values [x, y, width, height]). This annotation should be fixed.';
    case BBoxProblem.NON_NUMERIC:
      return 'Bounding box contains a value that is not a finite number. This annotation should be fixed.';
    case BBoxProblem.WIDTH_NOT_POSITIVE:
      return `Bounding box is invalid (width = ${describe(bbox[2])} <= 0). This annotation should be fixed.`;
    default:
      return `Bounding box is invalid (height = ${describe(bbox[3])} <= 0). This annotation should be fixed.`;
  }
}

// INVALID_BBOX (v1.md §15). An absent bbox (undefined / null) is not checked:
// V2 allows segmentation-only annotations, and a missing bbox field is a
// structural concern, not this rule.
function checkBBoxes(annotations) {
  const issues = [];
  const invalidAnnotationIds = [];
  for (const annotation of annotations) {
    const { bbox } = annotation;
    if (bbox === undefined || bbox === null) continue;
    const problem = findBBoxProblem(bbox);
    if (problem === null) continue;
    invalidAnnotationIds.push(annotation.id);
    issues.push(
      issueDescriptor({
        type: QAIssueType.INVALID_BBOX,
        imageId: annotation.imageId,
        annotationId: annotation.id,
        categoryId: annotation.categoryId,
        reason: bboxReason(bbox, problem),
        details: { bbox: preserveRaw(bbox), problem },
      })
    );
  }
  return result(issues, 'invalidAnnotationIds', invalidAnnotationIds);
}

function dimensionReason(image, problem) {
  const cause =
    problem === DimensionProblem.NON_NUMERIC
      ? `width = ${describe(image.width)}, height = ${describe(image.height)}; not a finite number`
      : problem === DimensionProblem.WIDTH_NOT_POSITIVE
        ? `width = ${describe(image.width)} <= 0`
        : `height = ${describe(image.height)} <= 0`;
  return (
    `Image has invalid dimensions (${cause}). Geometric checks (small object, truncated, ` +
    'out of bounds) cannot run for this image; the image metadata should be fixed.'
  );
}

// INVALID_IMAGE_DIMENSION (v1.md §16B). One issue per invalid image.
function checkImageDimensions(images) {
  const issues = [];
  const invalidImageIds = [];
  for (const image of images) {
    const problem = findDimensionProblem(image);
    if (problem === null) continue;
    invalidImageIds.push(image.id);
    issues.push(
      issueDescriptor({
        type: QAIssueType.INVALID_IMAGE_DIMENSION,
        imageId: image.id,
        reason: dimensionReason(image, problem),
        details: { width: preserveRaw(image.width), height: preserveRaw(image.height), problem },
      })
    );
  }
  return result(issues, 'invalidImageIds', invalidImageIds);
}

module.exports = {
  BBoxProblem,
  DimensionProblem,
  findBBoxProblem,
  findDimensionProblem,
  checkImageReferences,
  checkCategoryReferences,
  checkBBoxes,
  checkImageDimensions,
};
