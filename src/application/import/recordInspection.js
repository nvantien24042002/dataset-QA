'use strict';

// Record-level import inspection (Phase 4 Step 3B-1; v1.md §5, §16B, §29.2;
// v2.md §12). Pure — no I/O. The import boundary for Option 1 "QA at import
// time": it looks at the RAW parsed COCO DTO and decides, per record, what can
// be normalized into the strict canonical model and what is a record-level QA
// defect that must survive instead of crashing the import.
//
// This is ONLY the boundary / hook point. It does NOT run the QA engine, build
// QAIssues, assign a QARun, or persist anything — it reuses the committed Step 2
// predicates purely to partition records and collect raw defect data for a
// future runQaEngine.
//
// Canonical geometry stays strict: malformed bboxes are removed here BEFORE
// normalization, so createBBox()/createGeometry() are never called on them. A
// bbox that is value-invalid (v1.md §15) is dropped from the record; if the
// record then has no geometry at all it is excluded from normalization; if it
// still has a segmentation it is normalized as segmentation-only (v1.md §15
// "an INVALID_BBOX annotation keeps its other geometry"). A dangling image
// reference (v1.md §13) cannot be persisted (annotations.image_id is a NOT NULL
// FK), so such a record is excluded. A dangling CATEGORY reference (v1.md §14)
// is left in place: the annotation is otherwise valid and still persists.

const { findBBoxProblem, findDimensionProblem } = require('../../domain/qa/rules/recordRules');
const { normalizeId } = require('../../domain/dataset/references');

// Partition the raw DTO. Returns:
//   annotationsForNormalize   - the subset safe to hand to the strict normalizer
//                               (dangling-image and unbuildable-bbox records
//                               removed; a bad bbox stripped when a segmentation
//                               remains), order preserved
//   excludedAnnotations       - [{ annotation, reasons }] raw records that will
//                               NOT be normalized, with QA reason codes
//   invalidDimensionImageIds  - Set of RAW image ids whose present dimensions are
//                               value-invalid (so import can skip the fatal
//                               declared-vs-probed mismatch check for them)
function inspectRecords(dto) {
  const imageKeyById = new Set(dto.images.map((img) => normalizeId(img.id)));

  const invalidDimensionImageIds = new Set();
  for (const img of dto.images) {
    // Parser guarantees width/height are present (missing is fatal), so
    // findDimensionProblem never throws here.
    if (findDimensionProblem(img) !== null) invalidDimensionImageIds.add(img.id);
  }

  const annotationsForNormalize = [];
  const excludedAnnotations = [];
  for (const annotation of dto.annotations) {
    const reasons = [];

    const danglingImage = !imageKeyById.has(normalizeId(annotation.image_id));
    if (danglingImage) reasons.push('INVALID_IMAGE_REFERENCE');

    let dropBbox = false;
    let unbuildableBbox = false;
    const hasBbox = annotation.bbox !== undefined && annotation.bbox !== null;
    if (hasBbox && findBBoxProblem(annotation.bbox) !== null) {
      reasons.push('INVALID_BBOX');
      const hasSegmentation = annotation.segmentation != null;
      if (hasSegmentation) dropBbox = true; // keep as segmentation-only
      else unbuildableBbox = true; // no geometry can be built
    }

    if (danglingImage || unbuildableBbox) {
      excludedAnnotations.push({ annotation, reasons });
      continue;
    }
    // A value-invalid bbox with a surviving segmentation is still a QA defect,
    // but the record is normalizable without the bbox.
    if (dropBbox) {
      annotationsForNormalize.push({ ...annotation, bbox: undefined });
    } else if (hasBbox) {
      // A value-valid bbox may still hold numeric-looking strings ("20"), which
      // the strict createBBox() rejects. The normalized dataset coerces bbox
      // elements with Number() (v1.md §6.2); do that here so construction gets
      // finite numbers. findBBoxProblem===null guarantees each element coerces
      // to a finite number, so this never produces NaN.
      annotationsForNormalize.push({ ...annotation, bbox: annotation.bbox.map(Number) });
    } else {
      annotationsForNormalize.push(annotation);
    }
  }

  return { annotationsForNormalize, excludedAnnotations, invalidDimensionImageIds };
}

module.exports = { inspectRecords };
