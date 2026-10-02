'use strict';

// QADatasetView builder (Phase 4 Step 3B-2; v1.md §6.4, §13, §14, §15, §16B;
// v2.md §12). Pure — no I/O, no COCO/infrastructure types in the output.
//
// Builds the QA input boundary: a plain, QA-neutral view over the RAW parsed
// COCO DTO plus the Step 3B-1 inspection result. It preserves every record —
// including the ones held back from canonical normalization — with the raw
// values the record-level QA rules need, and annotates each with its canonical
// id (or null when no canonical row exists). It does NOT run the QA engine,
// adapt to the rule input shape (that is Step 3B-3), or persist anything.
//
// ID policy: matching uses the single §6.4 normalizeId policy from
// ../../domain/dataset/references; normalized ids are matching keys only and are
// never stored in the view. imageIds/categoryIds carry RAW ids. The builder must
// run only AFTER duplicate-id fatal validation has passed, so it needs no
// numeric/string ambiguity resolution of its own.

const { normalizeId } = require('../../domain/dataset/references');

// A canonical annotation row exists only when the record was handed to the
// strict normalizer (not dangling-image, not unbuildable-bbox). The excluded
// set carries exactly those raw records that were held back.
function buildQADatasetView({ dto, inspection, makeImageId, makeAnnotationId }) {
  // Resolvable image ids, keyed by the normalized form (§6.4): image.id = 1
  // resolves annotation.image_id = "1".
  const imageKeyByNorm = new Map();
  for (const img of dto.images) imageKeyByNorm.set(normalizeId(img.id), img.id);

  // Raw records that have NO canonical annotation row (held back from
  // normalization). Identity is the raw annotation object, so this matches the
  // exact records inspection excluded without re-deriving the reasons.
  const excludedRawAnnotations = new Set(
    inspection.excludedAnnotations.map((entry) => entry.annotation)
  );

  const images = dto.images.map((img) =>
    Object.freeze({
      rawId: img.id,
      canonicalId: makeImageId(img.id),
      fileName: img.file_name,
      width: img.width, // RAW: present-but-invalid dimensions are QA signals
      height: img.height,
    })
  );

  const annotations = dto.annotations.map((a) => {
    const normImageId = normalizeId(a.image_id);
    const imageResolves = imageKeyByNorm.has(normImageId);
    const canonicalImageId = imageResolves ? makeImageId(imageKeyByNorm.get(normImageId)) : null;
    // No canonical row when the record was excluded (dangling image or
    // unbuildable bbox). Note: a bad-bbox + segmentation record is NOT excluded,
    // so it keeps a canonical id — and we still read its ORIGINAL raw bbox below.
    const canonicalId = excludedRawAnnotations.has(a) ? null : makeAnnotationId(a.id);
    return Object.freeze({
      rawId: a.id,
      canonicalId,
      rawImageId: a.image_id,
      canonicalImageId,
      categoryId: a.category_id, // RAW; no FK, dangling value preserved
      // ORIGINAL raw bbox straight from the DTO (never the normalized/stripped
      // one), so INVALID_BBOX stays observable even when normalization dropped
      // the bbox to keep a segmentation-only canonical annotation.
      bbox: a.bbox !== undefined ? a.bbox : null,
      segmentation: a.segmentation !== undefined ? a.segmentation : null,
    });
  });

  // RAW-valued Sets, built fresh (never mutated after construction). Object.freeze
  // on a Set does not freeze its contents, so we simply do not expose a mutator
  // path — the view object is frozen and these Sets are not touched again.
  const imageIds = new Set(dto.images.map((img) => img.id));
  const categoryIds = new Set(dto.categories.map((c) => c.id));

  return Object.freeze({
    images: Object.freeze(images),
    annotations: Object.freeze(annotations),
    imageIds,
    categoryIds,
  });
}

module.exports = { buildQADatasetView };
