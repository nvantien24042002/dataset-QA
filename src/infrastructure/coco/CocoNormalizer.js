'use strict';

// COCO Normalizer (v2.md §13). COCO DTO → Canonical Domain Model. All knowledge
// of the COCO wire shape lives here so the domain stays COCO-independent.

const { CanonicalDataset } = require('../../domain/dataset/CanonicalDataset');
const { createImage } = require('../../domain/dataset/Image');
const { createCategory } = require('../../domain/dataset/Category');
const { createAnnotation } = require('../../domain/annotation/Annotation');
const { assertSafeRelativePath } = require('../../domain/dataset/pathSafety');
const { normalizeId } = require('../../domain/dataset/references');
const {
  GeometryType,
  createGeometry,
  createBBox,
  createSegmentationPolygon,
  createSegmentationRle,
} = require('../../domain/geometry/Geometry');
const { ValidationError } = require('../../domain/errors');

const MISSING_IMAGE_REF = (cocoImageId) => `__MISSING_IMAGE__::${cocoImageId}`;

function normalizeBBox(cocoBbox) {
  if (!Array.isArray(cocoBbox) || cocoBbox.length !== 4) return null;
  const [x, y, width, height] = cocoBbox;
  return createBBox({ x, y, width, height });
}

function normalizeSegmentation(seg) {
  if (seg == null) return null;
  // RLE: { counts, size }. Polygon: [[x0,y0,x1,y1,...], ...].
  if (!Array.isArray(seg) && typeof seg === 'object' && 'counts' in seg && 'size' in seg) {
    return createSegmentationRle({ size: seg.size, counts: seg.counts });
  }
  if (Array.isArray(seg)) {
    const polygons = seg.map((flat) => {
      if (!Array.isArray(flat)) {
        throw new ValidationError('Polygon ring must be a flat number array');
      }
      const points = [];
      for (let i = 0; i < flat.length; i += 2) points.push({ x: flat[i], y: flat[i + 1] });
      return points;
    });
    return createSegmentationPolygon(polygons);
  }
  return null;
}

/**
 * @param {{images:Array,annotations:Array,categories:Array}} dto - parsed COCO
 * @param {object} ctx
 * @param {(cocoImageId:any)=>string} ctx.makeImageId - canonical image id factory
 * @param {(cocoAnnotationId:any)=>string} ctx.makeAnnotationId - canonical annotation id factory
 * @param {Map<any,string>} [ctx.imageHashes] - cocoImageId → content fingerprint
 * @returns {CanonicalDataset}
 */
function normalize(dto, { makeImageId, makeAnnotationId, imageHashes = new Map() }) {
  // Image/category references match by the shared §6.4 id-normalization policy
  // (normalizeId), so image.id = 1 resolves annotation.image_id = "1". The maps
  // are keyed by the NORMALIZED id, and lookups normalize the reference the same
  // way — the same semantics recordInspection and the Step 2 QA rules use. This
  // keeps the import boundary consistent: a reference that recordInspection kept
  // as resolvable must resolve here too, instead of leaking a sentinel into
  // persistence (FK failure).
  const categoryNameById = new Map(dto.categories.map((c) => [normalizeId(c.id), c.name]));

  const imageIdMap = new Map();
  const images = dto.images.map((img) => {
    const canonicalId = makeImageId(img.id);
    imageIdMap.set(normalizeId(img.id), canonicalId);
    // Reject traversal/absolute file names at the import boundary before the
    // path is ever used to build a storage location (INV-08, path-safety).
    const safeFileName = assertSafeRelativePath(img.file_name, 'file_name');
    return createImage({
      id: canonicalId,
      fileName: img.file_name,
      relativePath: `images/${safeFileName}`,
      width: img.width,
      height: img.height,
      fingerprint: imageHashes.get(img.id) ?? null,
    });
  });

  const categories = dto.categories.map((c) =>
    createCategory({ id: c.id, name: c.name, supercategory: c.supercategory ?? null })
  );

  const annotations = dto.annotations.map((a) => {
    const bbox = normalizeBBox(a.bbox);
    const segmentation = normalizeSegmentation(a.segmentation);
    if (!bbox && !segmentation) {
      throw new ValidationError('Annotation has neither bbox nor segmentation', { id: a.id });
    }
    const type = segmentation ? GeometryType.SEGMENTATION : GeometryType.BBOX;
    const normImageId = normalizeId(a.image_id);
    const normCategoryId = normalizeId(a.category_id);
    return createAnnotation({
      id: makeAnnotationId(a.id),
      // A dangling image_id becomes a sentinel so reference validation can
      // report INVALID_IMAGE_REFERENCE rather than crashing normalization. The
      // sentinel keeps the ORIGINAL image_id for human traceability.
      imageId: imageIdMap.has(normImageId) ? imageIdMap.get(normImageId) : MISSING_IMAGE_REF(a.image_id),
      categoryId: a.category_id,
      categoryName: categoryNameById.has(normCategoryId) ? categoryNameById.get(normCategoryId) : null,
      geometry: createGeometry({
        type,
        bbox: bbox ? { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height } : null,
        segmentation,
      }),
      attributes: {},
      source: { type: 'COCO', originalId: a.id, originalImageId: a.image_id },
      metadata: { iscrowd: a.iscrowd ?? 0, area: a.area ?? null },
    });
  });

  return new CanonicalDataset({ images, categories, annotations });
}

module.exports = { normalize, normalizeBBox, normalizeSegmentation, MISSING_IMAGE_REF };
