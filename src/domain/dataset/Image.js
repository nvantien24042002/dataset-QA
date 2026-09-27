'use strict';

// Canonical Image (v2.md §4.1, §14.3 images). Paths are RELATIVE to the storage
// root, never machine-absolute, and must not traverse outside their directory
// (INV-08, path-safety guard).

const { ValidationError } = require('../errors');
const { assertSafeRelativePath } = require('./pathSafety');

function createImage({ id, fileName, relativePath, width = null, height = null, fingerprint = null }) {
  if (id == null) throw new ValidationError('Image.id is required');
  if (!fileName) throw new ValidationError('Image.fileName is required', { id });
  if (!relativePath) throw new ValidationError('Image.relativePath is required', { id });
  // Rejects absolute paths and any `..`/`.` traversal segment (INV-08).
  assertSafeRelativePath(relativePath, 'Image.relativePath');
  return Object.freeze({ id, fileName, relativePath, width, height, fingerprint });
}

module.exports = { createImage };
