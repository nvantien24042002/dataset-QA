'use strict';

// DatasetService (v2.md §15.2). Read use cases over datasets and their versions.
// No SQL (delegates to repositories) and no HTTP concerns. In Phase 2 this also
// covers version reads that §15.2 lists under DatasetVersionService; that
// service will be split out when write/diff use cases arrive in later phases.

const { NotFoundError } = require('../../domain/errors');

class DatasetService {
  constructor({ datasetRepository, datasetVersionRepository }) {
    this.datasets = datasetRepository;
    this.versions = datasetVersionRepository;
  }

  listDatasets() {
    return this.datasets.findAll();
  }

  getDataset(id) {
    const dataset = this.datasets.findById(id);
    if (!dataset) throw new NotFoundError('Dataset not found', { id });
    return dataset;
  }

  listVersions(datasetId) {
    this.getDataset(datasetId); // 404 if the dataset does not exist
    return this.versions.findByDataset(datasetId);
  }

  getVersion(datasetId, versionId) {
    const version = this.versions.findById(versionId);
    if (!version || version.dataset_id !== datasetId) {
      throw new NotFoundError('DatasetVersion not found', { datasetId, versionId });
    }
    return version;
  }
}

module.exports = { DatasetService };
