'use strict';

// DatasetRepository (v2.md §11.1, §14.3 datasets). Infrastructure layer.

const { BaseRepository } = require('./BaseRepository');

class DatasetRepository extends BaseRepository {
  /**
   * @param {{id:string,name:string,description?:string|null,createdAt:string,updatedAt:string}} dataset
   */
  create(dataset) {
    this.db
      .prepare(
        `INSERT INTO datasets (id, name, description, created_at, updated_at)
         VALUES (@id, @name, @description, @createdAt, @updatedAt)`
      )
      .run({
        id: dataset.id,
        name: dataset.name,
        description: dataset.description ?? null,
        createdAt: dataset.createdAt,
        updatedAt: dataset.updatedAt,
      });
    return this.findById(dataset.id);
  }

  findById(id) {
    return this.db.prepare(`SELECT * FROM datasets WHERE id = ?`).get(id) || null;
  }

  findAll() {
    return this.db.prepare(`SELECT * FROM datasets ORDER BY created_at DESC, id ASC`).all();
  }

  /** Create the dataset only if it does not already exist; returns the row. */
  upsert(dataset) {
    const existing = this.findById(dataset.id);
    if (existing) return existing;
    return this.create(dataset);
  }
}

module.exports = { DatasetRepository };
