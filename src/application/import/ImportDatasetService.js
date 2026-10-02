'use strict';

// ImportDatasetService (v2.md §12, §20 Import flow). Orchestrates the import
// pipeline end to end:
//
//   parse COCO → validate image files + dimensions → normalize to canonical
//   model → validate references → fingerprint → stage in temp → publish →
//   persist as an immutable READY DatasetVersion.
//
// A version is NEVER marked READY unless every image file exists, its declared
// dimensions match the file, all references resolve, files are published, and
// the DB transaction commits. Any failure leaves no READY version behind.
//
// Depends only on injected abstractions (constructor DI); the composition root
// wires the concrete infrastructure, keeping this application service free of
// direct infrastructure imports (v2.md §15 dependency direction).

const crypto = require('crypto');
const { VersionStatus } = require('../../domain/version/VersionStatus');
const { ValidationError } = require('../../domain/errors');
const { assertWithinDir } = require('../../domain/dataset/pathSafety');
const { inspectRecords } = require('./recordInspection');

// Reference defects are record-level QA concerns (v1.md §13, §14), NOT fatal
// import errors (Option 1, Phase 4). They are filtered out of the fatal set and
// left for the QA engine. Duplicate-id and all other codes stay fatal.
const QA_REFERENCE_CODES = new Set(['INVALID_IMAGE_REFERENCE', 'INVALID_CATEGORY_REFERENCE']);

class ImportDatasetService {
  constructor(deps) {
    this.datasets = deps.datasetRepository;
    this.versions = deps.datasetVersionRepository;
    this.images = deps.imageRepository;
    this.annotations = deps.annotationRepository;
    this.storage = deps.storage;
    this.coco = deps.cocoAdapter; // { parse, normalize }
    this.validateReferences = deps.validateReferences;
    this.probe = deps.imageProbe; // (buffer) -> { width, height }
    this.fingerprinter = deps.fingerprinter; // { datasetFingerprint, sha256Hex }
    this.idGenerator = deps.idGenerator || (() => crypto.randomUUID());
    this.clock = deps.clock || (() => new Date().toISOString());
    // QA integration (Phase 4 final step). Injected, not constructed here, so the
    // dependency direction stays inward (v2.md §15) and QAService owns its own
    // run lifecycle / persistence. All three are optional: when absent, import
    // behaves exactly as before (no post-commit QA), which keeps existing callers
    // and tests that do not care about QA working unchanged.
    this.qaService = deps.qaService || null;
    this.buildQADatasetView = deps.buildQADatasetView || null;
    this.rulesVersion = deps.rulesVersion || null;
  }

  // PLACEHOLDER_EXECUTE
  execute({ datasetId, datasetName, createdBy = null, source }) {
    if (!datasetId) throw new ValidationError('datasetId is required');
    if (!source || !source.exists()) {
      throw new ValidationError('Import source not found (expected annotations.json)', { datasetId });
    }

    const now = this.clock();
    const dto = this.coco.parse(source.readAnnotations());

    // Record-level QA boundary (Option 1, Phase 4). Partition the raw DTO up
    // front: a dangling-image or unbuildable-bbox record is held back so the
    // strict normalizer never sees it (canonical geometry stays malformed-free),
    // and value-invalid declared dimensions are noted. The excluded records and
    // defect sets are the hook the future runQaEngine consumes; this step
    // neither builds QAIssues nor persists them yet.
    const qaBoundary = inspectRecords(dto);

    // Validate image files + dimensions; hash bytes; cache buffers for staging.
    const errors = [];
    const imageHashes = new Map();
    const imageBuffers = new Map();
    for (const img of dto.images) {
      // Path safety (defense-in-depth): the file name must resolve inside the
      // version's own images/ root. This mirrors the domain guard in
      // createImage and guarantees staging can never write outside
      // datasets/<id>/versions/<v>/images/ even before normalization runs.
      try {
        assertWithinDir('images', img.file_name, 'file_name');
      } catch (e) {
        errors.push({ code: 'UNSAFE_IMAGE_PATH', imageId: img.id, fileName: img.file_name, message: e.message });
        continue;
      }
      if (!source.imageExists(img.file_name)) {
        errors.push({ code: 'MISSING_IMAGE_FILE', imageId: img.id, fileName: img.file_name });
        continue;
      }
      const buf = source.readImage(img.file_name);
      imageBuffers.set(img.file_name, buf);
      imageHashes.set(img.id, this.fingerprinter.sha256Hex(buf));
      let dims;
      try {
        dims = this.probe(buf);
      } catch (e) {
        errors.push({ code: 'UNREADABLE_IMAGE', imageId: img.id, fileName: img.file_name, message: e.message });
        continue;
      }
      // A value-invalid declared dimension is a record-level QA concern
      // (INVALID_IMAGE_DIMENSION, v1.md §16B), not a fatal declared-vs-probed
      // mismatch: skip the mismatch check for those images.
      if (qaBoundary.invalidDimensionImageIds.has(img.id)) continue;
      if (dims.width !== img.width || dims.height !== img.height) {
        errors.push({
          code: 'IMAGE_DIMENSION_MISMATCH',
          imageId: img.id,
          declared: { width: img.width, height: img.height },
          actual: { width: dims.width, height: dims.height },
        });
      }
    }

    // Unsafe paths must abort before normalization: the canonical model cannot
    // be built from a traversing file name, and no staging/publish may occur.
    if (errors.some((e) => e.code === 'UNSAFE_IMAGE_PATH')) {
      throw new ValidationError('Dataset failed import validation', { errors });
    }

    const versionId = this.idGenerator();

    // Canonical id factories. Hoisted so the SAME factories feed both the
    // normalizer (persistence) and the post-commit QADatasetView: this guarantees
    // the view's canonical ids are byte-identical to the persisted image/
    // annotation primary keys, so QAIssue FK targets resolve.
    const makeImageId = (cocoId) => `${versionId}::img::${cocoId}`;
    const makeAnnotationId = (cocoId) => `${versionId}::ann::${cocoId}`;

    const canonical = this.coco.normalize(
      { ...dto, annotations: qaBoundary.annotationsForNormalize },
      { makeImageId, makeAnnotationId, imageHashes }
    );

    // Dangling references are record-level QA concerns, not fatal (v1.md §13,
    // §14). Keep every other reference error (duplicate ids, etc.) fatal.
    for (const refError of this.validateReferences(canonical)) {
      if (!QA_REFERENCE_CODES.has(refError.code)) errors.push(refError);
    }
    if (errors.length > 0) {
      throw new ValidationError('Dataset failed import validation', { errors });
    }

    const fingerprint = this.fingerprinter.datasetFingerprint(dto, imageHashes);
    const versionNumber = this.versions.nextVersionNumber(datasetId);
    const manifest = this._buildManifest({
      datasetId,
      datasetName: datasetName || datasetId,
      versionId,
      versionNumber,
      createdAt: now,
      createdBy,
      fingerprint,
      canonical,
    });

    // Stage into temp, then publish only after validation succeeds (v2.md §12).
    const tempRel = `temp/import-${versionId}`;
    const finalRel = `datasets/${datasetId}/versions/v${versionNumber}`;
    this._stage(tempRel, source, dto, imageBuffers, manifest);
    this.storage.move(tempRel, finalRel);

    // Atomic persistence: create the dataset (if new) and the DRAFT version with
    // all images/annotations, then flip to READY — all or nothing.
    try {
      this.versions.transaction(() => {
        this.datasets.upsert({
          id: datasetId,
          name: datasetName || datasetId,
          description: null,
          createdAt: now,
          updatedAt: now,
        });
        this.versions.create({
          id: versionId,
          datasetId,
          versionNumber,
          parentVersionId: null,
          status: VersionStatus.DRAFT,
          fingerprint,
          createdAt: now,
          createdBy,
        });
        this.images.createMany(canonical.images.map((i) => ({ ...i, datasetVersionId: versionId })));
        this.annotations.createMany(canonical.annotations.map((a) => this._annotationRow(a, versionId)));
        this.versions.updateStatus(versionId, VersionStatus.READY);
      });
    } catch (e) {
      // Compensate the already-published files so no orphaned READY-looking dir
      // survives a failed commit.
      this.storage.removeDir(finalRel);
      throw e;
    }

    // Import transaction has committed: the version is durably READY.
    const version = this.versions.findById(versionId);

    // --- Post-commit QA (separate operation, separate transaction) ---
    // Runs ONLY after READY is committed. QA failure must never undo a valid
    // import: the view is built from the SAME raw dto + inspection + id factories
    // used above (never from persisted canonical data, which omits excluded
    // records and original raw bboxes), categories come from the raw dto, and any
    // throw from runAndPersist (engine failure or QA-persistence failure, both of
    // which are isolated inside QAService's own transaction) is swallowed so the
    // READY version is still returned. No storage/version compensation here —
    // that belongs only to pre-commit import failures.
    if (this.qaService && this.buildQADatasetView) {
      try {
        const view = this.buildQADatasetView({
          dto,
          inspection: qaBoundary,
          makeImageId,
          makeAnnotationId,
        });
        const categories = dto.categories.map((category) => ({
          rawId: category.id,
          name: category.name,
        }));
        this.qaService.runAndPersist({
          datasetVersionId: versionId,
          view,
          categories,
          rulesVersion: this.rulesVersion,
        });
      } catch (err) {
        // Isolated: the import already committed and stays READY. Surface the QA
        // failure without failing the import. No dedicated logger exists in this
        // codebase, so stderr is the minimal, explicit choice.
        // eslint-disable-next-line no-console
        console.error(`QA run failed for dataset version ${versionId}:`, err && err.message ? err.message : err);
      }
    }

    return version;
  }

  _annotationRow(annotation, versionId) {
    const { geometry } = annotation;
    return {
      id: annotation.id,
      datasetVersionId: versionId,
      imageId: annotation.imageId,
      categoryId: annotation.categoryId,
      categoryName: annotation.categoryName,
      geometryType: geometry.type,
      bboxJson: geometry.bbox ? JSON.stringify(geometry.bbox) : null,
      segmentationJson: geometry.segmentation ? JSON.stringify(geometry.segmentation) : null,
      attributesJson: JSON.stringify(annotation.attributes || {}),
      metadataJson: JSON.stringify(annotation.metadata || {}),
    };
  }

  _buildManifest({ datasetId, datasetName, versionId, versionNumber, createdAt, createdBy, fingerprint, canonical }) {
    return {
      schemaVersion: '1',
      datasetId,
      datasetName,
      versionId,
      versionNumber,
      status: VersionStatus.READY,
      createdAt,
      createdBy,
      fingerprint,
      counts: canonical.counts,
      categories: canonical.categories,
      images: canonical.images.map((i) => ({
        id: i.id,
        fileName: i.fileName,
        relativePath: i.relativePath,
        width: i.width,
        height: i.height,
        fingerprint: i.fingerprint,
      })),
      source: { annotations: 'source/annotations.json' },
    };
  }

  _stage(tempRel, source, dto, imageBuffers, manifest) {
    this.storage.save(`${tempRel}/source/annotations.json`, source.readAnnotations());
    for (const img of dto.images) {
      this.storage.save(`${tempRel}/images/${img.file_name}`, imageBuffers.get(img.file_name));
    }
    this.storage.save(`${tempRel}/manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)));
  }
}

module.exports = { ImportDatasetService };
