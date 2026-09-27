'use strict';

// Deterministic dataset-version fingerprint (v2.md §11.2, §12). v2.md names the
// `fingerprint` field and the "Calculate fingerprint" step but does not fix an
// algorithm, so this module DEFINES one:
//
//   fingerprint = SHA-256( canonicalJSON({ categories, images(+content hash),
//                                           annotations }) )
//
// Keys are sorted recursively and entities are sorted by their COCO id, so the
// same content always yields the same fingerprint regardless of import time,
// generated ids, or array ordering. Per-image content hashes make the
// fingerprint sensitive to the actual image bytes, not just the metadata.

const crypto = require('crypto');

function canonicalStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * @param {{images:Array,annotations:Array,categories:Array}} dto - parsed COCO (original ids)
 * @param {Map<any,string>} imageHashes - cocoImageId → sha256 hex of file bytes
 * @returns {string} sha256 hex fingerprint
 */
function datasetFingerprint(dto, imageHashes) {
  const view = {
    categories: [...dto.categories]
      .map((c) => ({ id: c.id, name: c.name, supercategory: c.supercategory ?? null }))
      .sort(byId),
    images: [...dto.images]
      .map((i) => ({
        id: i.id,
        file_name: i.file_name,
        width: i.width,
        height: i.height,
        hash: imageHashes.get(i.id) ?? null,
      }))
      .sort(byId),
    annotations: [...dto.annotations]
      .map((a) => ({
        id: a.id,
        image_id: a.image_id,
        category_id: a.category_id,
        bbox: a.bbox ?? null,
        segmentation: a.segmentation ?? null,
      }))
      .sort(byId),
  };
  return sha256Hex(canonicalStringify(view));
}

module.exports = { canonicalStringify, sha256Hex, datasetFingerprint };
