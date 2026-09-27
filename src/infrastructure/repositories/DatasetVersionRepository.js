'use strict';

// DatasetVersionRepository (v2.md §11.2, §14.3 dataset_versions). Infrastructure
// layer. The UNIQUE(dataset_id, version_number) constraint (INV-01) and foreign
// keys (INV-02 target existence) are enforced by the schema; immutability of
// READY versions (INV-05) is enforced by higher layers in later phases.

const { BaseRepository } = require('./BaseRepository');

class DatasetVersionRepository extends BaseRepository {
  /**
   * @param {{id:string,datasetId:string,versionNumber:number,parentVersionId?:string|null,
   *          status:string,fingerprint?:string|null,createdAt:string,createdBy?:string|null}} version
   */
  create(version) {
    this.db
      .prepare(
        `INSERT INTO dataset_versions
           (id, dataset_id, version_number, parent_version_id, status, fingerprint, created_at, created_by)
         VALUES
           (@id, @datasetId, @versionNumber, @parentVersionId, @status, @fingerprint, @createdAt, @createdBy)`
      )
      .run({
        id: version.id,
        datasetId: version.datasetId,
        versionNumber: version.versionNumber,
        parentVersionId: version.parentVersionId ?? null,
        status: version.status,
        fingerprint: version.fingerprint ?? null,
        createdAt: version.createdAt,
        createdBy: version.createdBy ?? null,
      });
    return this.findById(version.id);
  }

  findById(id) {
    return this.db.prepare(`SELECT * FROM dataset_versions WHERE id = ?`).get(id) || null;
  }

  findByDataset(datasetId) {
    return this.db
      .prepare(`SELECT * FROM dataset_versions WHERE dataset_id = ? ORDER BY version_number ASC`)
      .all(datasetId);
  }
}

module.exports = { DatasetVersionRepository };
