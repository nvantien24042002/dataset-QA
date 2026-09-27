'use strict';

// FileStorage — abstract contract for binary/artifact storage (v2.md §14).
// The filesystem is the source of truth for binaries; SQLite never stores image
// blobs (INV-26, INV-27). All paths are RELATIVE to the storage root, never
// machine-absolute (INV-08). Concrete implementation: LocalFileStorage.

/* eslint-disable no-unused-vars */
class FileStorage {
  /** Persist data at a relative path; returns the stored relative path. */
  save(relativePath, data) {
    throw new Error('FileStorage.save is not implemented');
  }

  /** Read the file at a relative path; returns a Buffer. */
  read(relativePath) {
    throw new Error('FileStorage.read is not implemented');
  }

  /** True if a file exists at the relative path. */
  exists(relativePath) {
    throw new Error('FileStorage.exists is not implemented');
  }

  /** Delete the file at the relative path (no-op if absent). */
  delete(relativePath) {
    throw new Error('FileStorage.delete is not implemented');
  }

  /** Resolve a relative path to an absolute path inside the storage root. */
  resolve(relativePath) {
    throw new Error('FileStorage.resolve is not implemented');
  }
}

module.exports = { FileStorage };
