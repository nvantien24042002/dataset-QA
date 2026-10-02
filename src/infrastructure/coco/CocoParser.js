'use strict';

// COCO Parser (v2.md §13). Raw COCO JSON (Buffer/string/object) → a validated
// COCO DTO. STRUCTURAL validation only; normalization into the canonical domain
// model is the Normalizer's job. The raw COCO shape never reaches the domain.

const { ValidationError } = require('../../domain/errors');

function parseCoco(raw) {
  let doc;
  try {
    doc = typeof raw === 'string' || Buffer.isBuffer(raw) ? JSON.parse(raw.toString('utf8')) : raw;
  } catch (e) {
    throw new ValidationError('annotations.json is not valid JSON', { cause: e.message });
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new ValidationError('COCO root must be an object');
  }
  for (const key of ['images', 'annotations', 'categories']) {
    if (!Array.isArray(doc[key])) {
      throw new ValidationError(`COCO.${key} must be an array`);
    }
  }

  doc.images.forEach((img, i) => {
    if (img == null || img.id == null) throw new ValidationError(`COCO image[${i}].id is required`);
    if (!img.file_name) {
      throw new ValidationError(`COCO image[${i}].file_name is required`, { id: img.id });
    }
    // A width/height that is entirely ABSENT is a fatal structural failure
    // (v1.md §5 row 6). A width/height that is PRESENT but has a bad value
    // (<=0, NaN, Infinity, numeric string) is NOT fatal here: it is a
    // record-level QA concern (INVALID_IMAGE_DIMENSION, v1.md §16B) and must
    // survive parsing so the QA layer can see it. Structural checks only.
    for (const field of ['width', 'height']) {
      if (img[field] === undefined) {
        throw new ValidationError(`COCO image[${i}].${field} is required`, { id: img.id });
      }
    }
  });

  doc.categories.forEach((c, i) => {
    if (c == null || c.id == null) throw new ValidationError(`COCO category[${i}].id is required`);
    if (!c.name) throw new ValidationError(`COCO category[${i}].name is required`, { id: c.id });
  });

  doc.annotations.forEach((a, i) => {
    if (a == null || a.id == null) throw new ValidationError(`COCO annotation[${i}].id is required`);
    if (a.image_id == null) {
      throw new ValidationError(`COCO annotation[${i}].image_id is required`, { id: a.id });
    }
    if (a.category_id == null) {
      throw new ValidationError(`COCO annotation[${i}].category_id is required`, { id: a.id });
    }
  });

  return { images: doc.images, annotations: doc.annotations, categories: doc.categories };
}

module.exports = { parseCoco };
