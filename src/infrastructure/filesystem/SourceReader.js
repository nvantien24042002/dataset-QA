'use strict';

// SourceReader — reads a dataset IMPORT SOURCE from an operator-supplied local
// directory of the form { annotations.json, images/ } (v2.md §12 Input).
//
// The source lives OUTSIDE the storage root (it is the operator's own path), so
// this reader is separate from LocalFileStorage (which forbids absolute paths).
// It only reads; it never writes. Note: this is a local, single-user tool with
// no authentication by design (v2.md §3), so the source path is trusted operator
// input — it is resolved but not sandboxed.

const path = require('path');
const fs = require('fs');

class SourceReader {
  constructor(sourceDir) {
    if (!sourceDir) throw new Error('SourceReader requires a source directory');
    this.sourceDir = path.resolve(sourceDir);
  }

  annotationsPath() {
    return path.join(this.sourceDir, 'annotations.json');
  }

  imagePath(fileName) {
    return path.join(this.sourceDir, 'images', fileName);
  }

  exists() {
    return fs.existsSync(this.sourceDir) && fs.existsSync(this.annotationsPath());
  }

  readAnnotations() {
    return fs.readFileSync(this.annotationsPath());
  }

  imageExists(fileName) {
    return fs.existsSync(this.imagePath(fileName));
  }

  readImage(fileName) {
    return fs.readFileSync(this.imagePath(fileName));
  }
}

module.exports = { SourceReader };
