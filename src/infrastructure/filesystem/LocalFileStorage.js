'use strict';

// LocalFileStorage — filesystem-backed FileStorage rooted at a base directory
// (v2.md §14.1 layout, INV-08/26/27). Rejects absolute paths and any relative
// path that escapes the storage root, so no machine-absolute path leaks in and
// nothing is written outside data/.

const path = require('path');
const fs = require('fs');
const { FileStorage } = require('./FileStorage');

class LocalFileStorage extends FileStorage {
  /**
   * @param {string} baseDir - storage root (e.g. the data/ directory).
   */
  constructor(baseDir) {
    super();
    if (!baseDir) {
      throw new Error('LocalFileStorage requires a base directory');
    }
    this.baseDir = path.resolve(baseDir);
  }

  _resolve(relativePath) {
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      throw new Error('relativePath must be a non-empty string');
    }
    if (path.isAbsolute(relativePath)) {
      throw new Error('relativePath must be relative, not absolute');
    }
    const full = path.resolve(this.baseDir, relativePath);
    const rel = path.relative(this.baseDir, full);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('relativePath escapes the storage root');
    }
    return full;
  }

  save(relativePath, data) {
    const full = this._resolve(relativePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
    return relativePath;
  }

  read(relativePath) {
    return fs.readFileSync(this._resolve(relativePath));
  }

  exists(relativePath) {
    return fs.existsSync(this._resolve(relativePath));
  }

  delete(relativePath) {
    const full = this._resolve(relativePath);
    if (fs.existsSync(full)) {
      fs.unlinkSync(full);
    }
  }

  resolve(relativePath) {
    return this._resolve(relativePath);
  }

  // Move a staged directory/file to its published location (v2.md §12: publish
  // only after validation succeeds). Overwrites any existing destination.
  move(fromRel, toRel) {
    const from = this._resolve(fromRel);
    const to = this._resolve(toRel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
    try {
      fs.renameSync(from, to);
    } catch (e) {
      if (e.code === 'EXDEV') {
        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
      } else {
        throw e;
      }
    }
  }

  // Recursively remove a directory (used to compensate a failed publish).
  removeDir(relativePath) {
    fs.rmSync(this._resolve(relativePath), { recursive: true, force: true });
  }
}

module.exports = { LocalFileStorage };
