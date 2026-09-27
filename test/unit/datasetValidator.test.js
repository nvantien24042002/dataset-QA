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
