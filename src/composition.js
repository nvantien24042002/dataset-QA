'use strict';

// Composition root. The ONLY place that wires concrete infrastructure to the
// application services (v2.md §15). This keeps app.js/presentation and every
// application/domain module free of direct infrastructure construction, so the
// dependency arrows point inward.

const crypto = require('crypto');
const { DatasetRepository } = require('./infrastructure/repositories/DatasetRepository');
const { DatasetVersionRepository } = require('./infrastructure/repositories/DatasetVersionRepository');
const { ImageRepository } = require('./infrastructure/repositories/ImageRepository');
const { AnnotationRepository } = require('./infrastructure/repositories/AnnotationRepository');
const { QaRunRepository } = require('./infrastructure/repositories/QaRunRepository');
const { QaIssueRepository } = require('./infrastructure/repositories/QaIssueRepository');
const { LocalFileStorage } = require('./infrastructure/filesystem/LocalFileStorage');
const { SourceReader } = require('./infrastructure/filesystem/SourceReader');
const { parseCoco } = require('./infrastructure/coco/CocoParser');
const { normalize } = require('./infrastructure/coco/CocoNormalizer');
const { probeImageDimensions } = require('./infrastructure/filesystem/imageProbe');
const { datasetFingerprint, sha256Hex } = require('./infrastructure/fingerprint');
const { validateReferences } = require('./domain/dataset/DatasetValidator');
const { runQaEngine } = require('./domain/qa/runQaEngine');
const { DatasetService } = require('./application/dataset/DatasetService');
const { ImportDatasetService } = require('./application/import/ImportDatasetService');
const { QAService } = require('./application/qa/QAService');

function buildServices({ db, dataDir }) {
  const datasetRepository = new DatasetRepository(db);
  const datasetVersionRepository = new DatasetVersionRepository(db);
  const imageRepository = new ImageRepository(db);
  const annotationRepository = new AnnotationRepository(db);
  const qaRunRepository = new QaRunRepository(db);
  const qaIssueRepository = new QaIssueRepository(db);
  const storage = new LocalFileStorage(dataDir);

  const datasetService = new DatasetService({ datasetRepository, datasetVersionRepository });
  const importService = new ImportDatasetService({
    datasetRepository,
    datasetVersionRepository,
    imageRepository,
    annotationRepository,
    storage,
    cocoAdapter: { parse: parseCoco, normalize },
    validateReferences,
    imageProbe: probeImageDimensions,
    fingerprinter: { datasetFingerprint, sha256Hex },
  });

  // QA persistence orchestrator. A SEPARATE operation from import (not invoked by
  // ImportDatasetService in this milestone); rulesVersion is supplied here so the
  // domain engine/rules never hard-code a version.
  const qaService = new QAService({
    qaRunRepository,
    qaIssueRepository,
    runQaEngine,
    idGenerator: () => crypto.randomUUID(),
    clock: () => new Date().toISOString(),
  });

  const sourceReaderFactory = (sourcePath) => new SourceReader(sourcePath);
  return { datasetService, importService, qaService, sourceReaderFactory };
}

module.exports = { buildServices };
