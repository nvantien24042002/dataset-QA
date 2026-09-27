'use strict';

// AnnotationRepository (v2.md §14.3 annotations, §14.4). Infrastructure layer.
// Geometry is persisted as JSON columns (bbox_json, segmentation_json); the
// stored JSON is NOT the domain representation (INV-32) — it is rehydrated by
// higher layers when needed.

const { BaseRepository } = require('./BaseRepository');

class AnnotationRepository extends BaseRepository {
  create(annotation) {
    this.db
      .prepare(
        `INSERT INTO annotations
           (id, dataset_version_id, image_id, category_id, category_name,
            geometry_type, bbox_json, segmentation_json, attributes_json, metadata_json)
         VALUES
           (@id, @datasetVersionId, @imageId, @categoryId, @categoryName,
            @geometryType, @bboxJson, @segmentationJson, @attributesJson, @metadataJson)`
      )
      .run({
        id: annotation.id,
        datasetVersionId: annotation.datasetVersionId,
        imageId: annotation.imageId,
        categoryId: annotation.categoryId ?? null,
        categoryName: annotation.categoryName ?? null,
        geometryType: annotation.geometryType ?? null,
        bboxJson: annotation.bboxJson ?? null,
        segmentationJson: annotation.segmentationJson ?? null,
        attributesJson: annotation.attributesJson ?? null,
        metadataJson: annotation.metadataJson ?? null,
      });
    return this.findById(annotation.id);
  }

  createMany(annotations) {
    for (const annotation of annotations) this.create(annotation);
    return annotations.length;
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) || null;
  }

  findByVersion(datasetVersionId) {
    return this.db
      .prepare('SELECT * FROM annotations WHERE dataset_version_id = ? ORDER BY id ASC')
      .all(datasetVersionId);
  }

  findByImage(datasetVersionId, imageId) {
    return this.db
      .prepare(
        'SELECT * FROM annotations WHERE dataset_version_id = ? AND image_id = ? ORDER BY id ASC'
      )
      .all(datasetVersionId, imageId);
  }
}

module.exports = { AnnotationRepository };
