'use strict';

// Shared reference-resolution policy (v2.md §12 "Validate references"; v1.md
// §6.4, §13, §14). Pure — no I/O, no error or issue construction.
//
// One definition of "dangling reference" used by both:
//   - the import gate (DatasetValidator.validateReferences), and
//   - the QA reference rules (src/domain/qa/rules/recordRules.js).
// Each caller decides what a dangling reference MEANS for it (an import error
// descriptor vs. a QA issue).
//
// normalizeId is the SINGLE id-normalization policy (v1.md §6.4): an id that
// looks numeric is compared as a Number, so image.id = 1 matches
// annotation.image_id = "1". It is applied consistently to BOTH sides — the
// id set/keys AND the reference value — by the caller that holds raw ids (the
// QA rules). DatasetValidator operates on already-canonical TEXT ids
// (v2.md §14.3, e.g. "<ver>::img::1"), which are already-normalized identifiers
// shared by both sides; normalizing those as numbers would collapse them to
// NaN, so the gate matches them by identity. Same policy, applied at the layer
// where ids are still raw.

// Normalize a reference id for matching (NOT for storage): a finite number or a
// numeric-looking string becomes that Number; anything else (a non-numeric
// string such as a canonical TEXT id or "abc", or null/undefined) is returned
// unchanged, so it only matches an identical value and otherwise stays dangling.
function normalizeId(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}

// `imageIds` / `categoryIds` are anything with has(): a Set of ids or a Map
// keyed by id. Strict membership; callers that hold raw ids normalize both
// sides with normalizeId first.
function hasDanglingImageReference(annotation, imageIds) {
  return !imageIds.has(annotation.imageId);
}

function hasDanglingCategoryReference(annotation, categoryIds) {
  return !categoryIds.has(annotation.categoryId);
}

module.exports = { normalizeId, hasDanglingImageReference, hasDanglingCategoryReference };
