'use strict';

// API DTO mappers (v2.md §16: map result to DTO). Convert DB rows (snake_case)
// to the JSON contract (camelCase). Presentation layer only.

function datasetToDto(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function versionToDto(row) {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    versionNumber: row.version_number,
    parentVersionId: row.parent_version_id ?? null,
    status: row.status,
    fingerprint: row.fingerprint ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
  };
}

module.exports = { datasetToDto, versionToDto };
