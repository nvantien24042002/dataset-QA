'use strict';

// Canonical Annotation (v2.md §4.2). Independent of raw COCO (§13). An
// Annotation MUST NOT carry review status/decision, reviewer identity, or QA
// severity (§4.2) — those live in the separate Review lifecycle.

const { ValidationError } = require('../errors');

const FORBIDDEN_ATTRIBUTE_KEYS = [
  'status',
  'decision',
  'reviewer',
  'reviewerId',
  'reviewStatus',
  'severity',
];

function createAnnotation({
  id,
  imageId,
  categoryId,
  categoryName = null,
  geometry,
  attributes = {},
  source = null,
  metadata = {},
}) {
  if (id == null) throw new ValidationError('Annotation.id is required');
  if (imageId == null) throw new ValidationError('Annotation.imageId is required', { id });
  if (categoryId == null) throw new ValidationError('Annotation.categoryId is required', { id });
  if (!geometry) throw new ValidationError('Annotation.geometry is required', { id });

  for (const key of FORBIDDEN_ATTRIBUTE_KEYS) {
    if (attributes && Object.prototype.hasOwnProperty.call(attributes, key)) {
      throw new ValidationError(
        `Annotation.attributes must not contain review/QA field: ${key}`,
        { id, key }
      );
    }
  }

  return Object.freeze({ id, imageId, categoryId, categoryName, geometry, attributes, source, metadata });
}

module.exports = { createAnnotation, FORBIDDEN_ATTRIBUTE_KEYS };
