'use strict';

// Geometry eligibility / cascade gating (Phase 4 Step 3B-4; v1.md §15, §16B,
// §29.2 step 3). Pure, ZERO imports. It centralizes the single geometry-
// eligibility fact the future geometric rules (SMALL_OBJECT, TRUNCATED,
// OUT_OF_BOUNDS_BBOX) depend on, so each rule does not re-derive the cascade and
// risk mishandling the category-reference exclusion.
//
// It produces NO issue descriptors, assigns NO severity, implements NO geometry
// rule, and mutates nothing. It only reads the committed QADatasetView and the
// four primitive invalidSets from runQaEngine, and returns the set of RAW
// annotation ids that must be skipped by geometry rules.
//
// Cascade (v1.md §29.2 step 3): an annotation is geometry-INELIGIBLE iff it has a
// dangling image reference, OR an invalid bbox, OR belongs to a dimension-invalid
// image. A dangling CATEGORY reference (v1.md §14) does NOT suppress geometry —
// it only excludes the annotation from class distribution — so
// invalidCategoryReferenceAnnotationIds is never consulted here.
//
// ID identity: annotation-keyed sets match on the raw annotation id directly
// (same field, same source). The dimension set holds RAW image ids; it is
// bridged to annotations through the view's already-resolved canonicalImageId
// (the view builder applied the single §6.4 normalizeId policy), so NO second
// normalization is introduced. canonicalImageId is treated as an opaque identity
// — compared by equality only, never parsed or constructed.

// Returns a fresh Set<rawAnnotationId> of annotations that geometry rules must
// skip. `invalidSets` is the runQaEngine output; only three of its four
// primitives feed geometry suppression (category-reference is intentionally
// excluded).
function geometryIneligibleAnnotationIds(view, invalidSets) {
  const {
    invalidImageReferenceAnnotationIds,
    invalidBBoxAnnotationIds,
    invalidDimensionImageIds,
  } = invalidSets;

  // Canonical identities of dimension-invalid images. Built from image.rawId (the
  // same raw id checkImageDimensions keyed invalidDimensionImageIds by), mapped to
  // the image's resolved canonicalId. Null canonical ids are ignored.
  const dimInvalidCanonicalIds = new Set();
  for (const image of view.images) {
    if (invalidDimensionImageIds.has(image.rawId) && image.canonicalId !== null) {
      dimInvalidCanonicalIds.add(image.canonicalId);
    }
  }

  const ineligible = new Set();
  for (const annotation of view.annotations) {
    const danglingImage = invalidImageReferenceAnnotationIds.has(annotation.rawId);
    const invalidBBox = invalidBBoxAnnotationIds.has(annotation.rawId);
    const dimensionInvalid =
      annotation.canonicalImageId !== null &&
      dimInvalidCanonicalIds.has(annotation.canonicalImageId);

    // Set membership is idempotent: an annotation flagged by several conditions
    // appears exactly once.
    if (danglingImage || invalidBBox || dimensionInvalid) {
      ineligible.add(annotation.rawId);
    }
  }

  return ineligible;
}

// Thin membership predicate over a precomputed ineligible set, for readability at
// future geometry call sites. Does not recompute the cascade.
function isGeometryEligible(annotation, ineligibleAnnotationIds) {
  return !ineligibleAnnotationIds.has(annotation.rawId);
}

module.exports = { geometryIneligibleAnnotationIds, isGeometryEligible };
