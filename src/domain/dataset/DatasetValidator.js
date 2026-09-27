'use strict';

// Reference & integrity validation over a CanonicalDataset (v2.md §12 "Validate
// references"). Pure — no I/O. Returns an array of error descriptors; an empty
// array means the dataset's internal references are consistent.
//
// This is an IMPORT GATE, distinct from the QA engine (Phase 4). It enforces
// INV-07 (annotation.image_id resolves within the version) and rejects dangling
// category references and duplicate ids before a version can become READY.

function validateReferences(dataset) {
  const errors = [];

  const imageIds = new Set();
  for (const image of dataset.images) {
    if (imageIds.has(image.id)) errors.push({ code: 'DUPLICATE_IMAGE_ID', imageId: image.id });
    imageIds.add(image.id);
  }

  const categoryIds = new Set();
  for (const category of dataset.categories) {
    if (categoryIds.has(category.id)) {
      errors.push({ code: 'DUPLICATE_CATEGORY_ID', categoryId: category.id });
    }
    categoryIds.add(category.id);
  }

  const annotationIds = new Set();
  for (const annotation of dataset.annotations) {
    if (annotationIds.has(annotation.id)) {
      errors.push({ code: 'DUPLICATE_ANNOTATION_ID', annotationId: annotation.id });
    }
    annotationIds.add(annotation.id);

    if (!imageIds.has(annotation.imageId)) {
      errors.push({
        code: 'INVALID_IMAGE_REFERENCE',
        annotationId: annotation.id,
        imageId: annotation.imageId,
      });
    }
    if (!categoryIds.has(annotation.categoryId)) {
      errors.push({
        code: 'INVALID_CATEGORY_REFERENCE',
        annotationId: annotation.id,
        categoryId: annotation.categoryId,
      });
    }
  }

  return errors;
}

module.exports = { validateReferences };
