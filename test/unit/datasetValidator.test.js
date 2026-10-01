'use strict';

// Phase 2 unit test — reference validation (v2.md §12, INV-07).

const { test } = require('node:test');
const assert = require('node:assert');
const { validateReferences } = require('../../src/domain/dataset/DatasetValidator');
const { CanonicalDataset } = require('../../src/domain/dataset/CanonicalDataset');

const ds = (parts) => new CanonicalDataset(parts);

test('a consistent dataset yields no errors', () => {
  const d = ds({
    images: [{ id: 'i1' }],
    categories: [{ id: 1, name: 'c' }],
    annotations: [{ id: 'a1', imageId: 'i1', categoryId: 1 }],
  });
  assert.deepStrictEqual(validateReferences(d), []);
});

test('detects an invalid image reference', () => {
  const d = ds({
    images: [{ id: 'i1' }],
    categories: [{ id: 1 }],
    annotations: [{ id: 'a1', imageId: 'X', categoryId: 1 }],
  });
  assert.ok(validateReferences(d).some((e) => e.code === 'INVALID_IMAGE_REFERENCE'));
});

test('detects an invalid category reference', () => {
  const d = ds({
    images: [{ id: 'i1' }],
    categories: [{ id: 1 }],
    annotations: [{ id: 'a1', imageId: 'i1', categoryId: 9 }],
  });
  assert.ok(validateReferences(d).some((e) => e.code === 'INVALID_CATEGORY_REFERENCE'));
});

test('error descriptors keep their exact shape and order (Phase 4 Step 2 regression)', () => {
  const d = ds({
    images: [{ id: 'i1' }, { id: 'i1' }],
    categories: [{ id: 1 }, { id: 1 }],
    annotations: [
      { id: 'a1', imageId: 'X', categoryId: 9 },
      { id: 'a2', imageId: 'i1', categoryId: 1 },
      { id: 'a2', imageId: 'Y', categoryId: 1 },
      { id: 'a3', imageId: 'i1', categoryId: 8 },
    ],
  });
  assert.deepStrictEqual(validateReferences(d), [
    { code: 'DUPLICATE_IMAGE_ID', imageId: 'i1' },
    { code: 'DUPLICATE_CATEGORY_ID', categoryId: 1 },
    { code: 'INVALID_IMAGE_REFERENCE', annotationId: 'a1', imageId: 'X' },
    { code: 'INVALID_CATEGORY_REFERENCE', annotationId: 'a1', categoryId: 9 },
    { code: 'DUPLICATE_ANNOTATION_ID', annotationId: 'a2' },
    { code: 'INVALID_IMAGE_REFERENCE', annotationId: 'a2', imageId: 'Y' },
    { code: 'INVALID_CATEGORY_REFERENCE', annotationId: 'a3', categoryId: 8 },
  ]);
});

test('reference matching is strict: a numeric id does not match its string form', () => {
  const d = ds({
    images: [{ id: 1 }],
    categories: [{ id: 1 }],
    annotations: [{ id: 'a1', imageId: '1', categoryId: '1' }],
  });
  assert.deepStrictEqual(
    validateReferences(d).map((e) => e.code),
    ['INVALID_IMAGE_REFERENCE', 'INVALID_CATEGORY_REFERENCE']
  );
});

test('detects duplicate annotation ids', () => {
  const d = ds({
    images: [{ id: 'i1' }],
    categories: [{ id: 1 }],
    annotations: [
      { id: 'a1', imageId: 'i1', categoryId: 1 },
      { id: 'a1', imageId: 'i1', categoryId: 1 },
    ],
  });
  assert.ok(validateReferences(d).some((e) => e.code === 'DUPLICATE_ANNOTATION_ID'));
});
