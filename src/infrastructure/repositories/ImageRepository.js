'use strict';

// ImageRepository (v2.md §14.3 images, §14.4). Infrastructure layer. All SQL for
// canonical images lives here. Foreign key to dataset_versions is enforced by
// the schema (INV-06/07 support).

const { BaseRepository } = require('./BaseRepository');

class ImageRepository extends BaseRepository {
  create(image) {
    this.db
      .prepare(
        `INSERT INTO images (id, dataset_version_id, file_name, relative_path, width, height, fingerprint)
         VALUES (@id, @datasetVersionId, @fileName, @relativePath, @width, @height, @fingerprint)`
      )
      .run({
        id: image.id,
        datasetVersionId: image.datasetVersionId,
        fileName: image.fileName,
        relativePath: image.relativePath,
        width: image.width ?? null,
        height: image.height ?? null,
        fingerprint: image.fingerprint ?? null,
      });
    return this.findById(image.id);
  }

  createMany(images) {
    for (const image of images) this.create(image);
    return images.length;
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM images WHERE id = ?').get(id) || null;
  }

  findByVersion(datasetVersionId) {
    return this.db
      .prepare('SELECT * FROM images WHERE dataset_version_id = ? ORDER BY id ASC')
      .all(datasetVersionId);
  }
}

module.exports = { ImageRepository };
