'use strict';

// Dataset controllers (v2.md §16). THIN: validate/shape the HTTP request, call
// an application service, map the result to a DTO. No business logic, no SQL.
// A SourceReader is built via an injected factory so the controller has no
// direct infrastructure dependency.

const { BadRequestError } = require('../../domain/errors');
const { datasetToDto, versionToDto } = require('../dto/datasetDto');

function createDatasetController({ datasetService, importService, sourceReaderFactory }) {
  return {
    list(req, res, next) {
      try {
        res.status(200).json({ datasets: datasetService.listDatasets().map(datasetToDto) });
      } catch (e) {
        next(e);
      }
    },

    get(req, res, next) {
      try {
        res.status(200).json(datasetToDto(datasetService.getDataset(req.params.id)));
      } catch (e) {
        next(e);
      }
    },

    listVersions(req, res, next) {
      try {
        const versions = datasetService.listVersions(req.params.id).map(versionToDto);
        res.status(200).json({ versions });
      } catch (e) {
        next(e);
      }
    },

    getVersion(req, res, next) {
      try {
        const version = datasetService.getVersion(req.params.id, req.params.versionId);
        res.status(200).json(versionToDto(version));
      } catch (e) {
        next(e);
      }
    },

    createVersion(req, res, next) {
      try {
        const { sourcePath, datasetName, createdBy } = req.body || {};
        if (!sourcePath) throw new BadRequestError('sourcePath is required');
        const source = sourceReaderFactory(sourcePath);
        const version = importService.execute({
          datasetId: req.params.id,
          datasetName,
          createdBy,
          source,
        });
        res.status(201).json(versionToDto(version));
      } catch (e) {
        next(e);
      }
    },
  };
}

module.exports = { createDatasetController };
