'use strict';

// Canonical Category (v2.md §13 normalization). Categories are denormalized onto
// annotations at storage time (there is no categories table in §14.2); this
// model is used during import/normalization and in the dataset manifest.

const { ValidationError } = require('../errors');

function createCategory({ id, name, supercategory = null }) {
  if (id == null) throw new ValidationError('Category.id is required');
  if (!name) throw new ValidationError('Category.name is required', { id });
  return Object.freeze({ id, name, supercategory });
}

module.exports = { createCategory };
