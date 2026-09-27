'use strict';

// CanonicalDataset — the normalized dataset content (images, categories,
// annotations), independent of raw COCO (v2.md §13). Aggregate with lookup maps
// used by validation and persistence.

class CanonicalDataset {
  constructor({ images = [], categories = [], annotations = [] }) {
    this.images = images;
    this.categories = categories;
    this.annotations = annotations;
    this._imageById = new Map(images.map((i) => [i.id, i]));
    this._categoryById = new Map(categories.map((c) => [c.id, c]));
  }

  getImage(id) {
    return this._imageById.get(id) || null;
  }

  getCategory(id) {
    return this._categoryById.get(id) || null;
  }

  get counts() {
    return {
      images: this.images.length,
      categories: this.categories.length,
      annotations: this.annotations.length,
    };
  }
}

module.exports = { CanonicalDataset };
