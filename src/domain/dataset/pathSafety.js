'use strict';

// Safe relative-path enforcement for imported asset file names (v2.md §14.1,
// INV-08). Pure — no I/O. An imported image `file_name` must be a relative path
// that stays within its intended directory, so a dataset import can NEVER write
// outside datasets/<datasetId>/versions/<version>/images/.
//
// This is the domain/import boundary guard. LocalFileStorage still independently
// protects the global data root; this adds the per-version-directory guarantee
// that the root guard alone does not provide.

const { ValidationError } = require('../errors');

// Split on BOTH POSIX and Windows separators so `..\..\x` is caught on any OS.
function segmentsOf(p) {
  return p.split(/[\\/]+/);
}

// POSIX absolute / UNC (`/x`, `\x`, `\\host`) or Windows drive (`C:\`, `C:/`, `C:`).
function isAbsoluteAnyOs(p) {
  return /^[\\/]/.test(p) || /^[a-zA-Z]:/.test(p);
}

/**
 * Validate a relative subpath and return its normalized POSIX form.
 * Rejects absolute paths, drive letters, and any `..`/`.`/empty traversal
 * segment. Accepts normal and nested relative names (e.g. `nested/path/x.jpg`).
 * @throws {ValidationError}
 */
function assertSafeRelativePath(value, field = 'path') {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${field} must be a non-empty string`, { value });
  }
  if (isAbsoluteAnyOs(value)) {
    throw new ValidationError(`${field} must be relative, not absolute: ${value}`, { value });
  }
  const segments = segmentsOf(value);
  for (const seg of segments) {
    if (seg === '..') {
      throw new ValidationError(`${field} must not contain '..' path traversal: ${value}`, { value });
    }
    if (seg === '' || seg === '.') {
      throw new ValidationError(`${field} must not contain empty or '.' segments: ${value}`, { value });
    }
  }
  return segments.join('/');
}

/**
 * Verify `subpath` resolves inside `root` (both relative POSIX dirs) and return
 * the normalized joined path. Defense-in-depth: even after normalization the
 * result must remain under the version's image root.
 * @throws {ValidationError}
 */
function assertWithinDir(root, subpath, field = 'path') {
  const safe = assertSafeRelativePath(subpath, field);
  const rootNorm = root.replace(/[\\/]+$/, '');
  const resolved = [];
  for (const seg of `${rootNorm}/${safe}`.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(seg);
  }
  const normalized = resolved.join('/');
  if (normalized !== rootNorm && !normalized.startsWith(`${rootNorm}/`)) {
    throw new ValidationError(`${field} escapes ${rootNorm}: ${subpath}`, { subpath });
  }
  return normalized;
}

module.exports = { assertSafeRelativePath, assertWithinDir };
