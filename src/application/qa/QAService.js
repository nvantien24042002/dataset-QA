'use strict';

// QAService (application layer; v2.md §14.4 Service → Repository, §28 QA flow).
// Orchestrates a QA run over an already-READY DatasetVersion: establishes the
// QARun lifecycle, invokes the pure domain engine, materializes issue descriptors
// into canonical QAIssue domain objects (mapping raw ids → canonical TEXT FK ids
// via the QADatasetView), and persists the COMPLETED run plus all issues
// atomically. QA persistence is a SEPARATE operation from import (this service is
// not called inside the import transaction in this milestone).
//
// Boundary: the domain engine (runQaEngine) and QARun/QAIssue models stay
// framework/DB-agnostic; this service owns orchestration and id mapping, and the
// injected repositories own SQL.

const { createQARun, QARunStatus } = require('../../domain/qa/QARun');
const { createQAIssue } = require('../../domain/qa/QAIssue');

class QAService {
  constructor(deps) {
    this.qaRuns = deps.qaRunRepository;
    this.qaIssues = deps.qaIssueRepository;
    this.runQaEngine = deps.runQaEngine;
    this.idGenerator = deps.idGenerator;
    this.clock = deps.clock; // () => ISO-8601 string
  }

  // Build raw-id -> canonical-id lookups from the view. Raw ids can be numeric or
  // string; the view already resolved canonical ids with the single normalizeId
  // policy, so we key by the raw id as the engine descriptors reference it.
  _canonicalMaps(view) {
    const imageByRaw = new Map();
    for (const image of view.images) imageByRaw.set(image.rawId, image.canonicalId);
    const annotationByRaw = new Map();
    for (const annotation of view.annotations) {
      // canonicalId is null for records with no persisted row (dangling image /
      // unbuildable bbox); such ids never reach a persistable issue annotationId.
      annotationByRaw.set(annotation.rawId, annotation.canonicalId);
    }
    return { imageByRaw, annotationByRaw };
  }

  // Convert one engine descriptor (raw-id based) into QAIssue fields with
  // canonical FK ids. Dangling image findings keep imageId = null; a raw image/
  // annotation id that does not resolve to a canonical row stays null (never a
  // fabricated id) and the raw reference is preserved in details.
  _toIssueFields(descriptor, { qaRunId, datasetVersionId, createdAt, maps }) {
    const details = { ...descriptor.details };

    let imageId = null;
    if (descriptor.imageId !== null && descriptor.imageId !== undefined) {
      const canonical = maps.imageByRaw.get(descriptor.imageId);
      if (canonical != null) {
        imageId = canonical;
      } else {
        // Unresolvable raw image reference — keep null, preserve raw for diagnosis.
        details.rawImageId = descriptor.imageId;
      }
    }

    let annotationId = null;
    if (descriptor.annotationId !== null && descriptor.annotationId !== undefined) {
      const canonical = maps.annotationByRaw.get(descriptor.annotationId);
      if (canonical != null) {
        annotationId = canonical;
      } else {
        // No persisted canonical annotation row (e.g. unbuildable bbox / dangling
        // image). Keep annotationId null (FK-safe) and preserve the raw id.
        details.rawAnnotationId = descriptor.annotationId;
      }
    }

    return {
      id: this.idGenerator(),
      qaRunId,
      datasetVersionId,
      type: descriptor.type,
      severity: descriptor.severity,
      imageId, // explicit (may be null) — satisfies the required-key contract
      annotationId,
      categoryId: descriptor.categoryId ?? null, // raw category id (no FK)
      reason: descriptor.reason,
      details,
      createdAt,
    };
  }

  // Run QA over a READY DatasetVersion and persist the result. Returns the
  // persisted QARun row.
  runAndPersist({ datasetVersionId, view, categories = [], rulesVersion }) {
    const startedAt = this.clock();

    // RUNNING run — created in memory first so a failure before persistence is
    // representable as FAILED without a half-written COMPLETED run.
    const runId = this.idGenerator();
    const runningRun = createQARun({
      id: runId,
      datasetVersionId,
      rulesVersion,
      status: QARunStatus.RUNNING,
      startedAt,
    });

    let result;
    try {
      result = this.runQaEngine(view, { categories });
    } catch (err) {
      // Engine execution failure → persist a FAILED run (both timestamps set, no
      // issues). FAILED payload is limited to fields the domain/schema support.
      const completedAt = this.clock();
      const failedRun = createQARun({
        id: runId,
        datasetVersionId,
        rulesVersion,
        status: QARunStatus.FAILED,
        startedAt,
        completedAt,
        summary: null,
      });
      this.qaRuns.create(failedRun);
      throw err;
    }

    const completedAt = this.clock();
    const maps = this._canonicalMaps(view);
    const issues = result.issues.map((descriptor) =>
      createQAIssue(
        this._toIssueFields(descriptor, { qaRunId: runId, datasetVersionId, createdAt: completedAt, maps })
      )
    );

    // COMPLETED run + all issues persisted atomically: if any issue insert fails
    // the whole transaction rolls back and no partial issue set remains.
    const completedRun = createQARun({
      id: runId,
      datasetVersionId,
      rulesVersion,
      status: QARunStatus.COMPLETED,
      startedAt,
      completedAt,
      summary: result.summary,
    });

    return this.qaRuns.transaction(() => {
      const persisted = this.qaRuns.create(completedRun);
      this.qaIssues.createMany(issues);
      return persisted;
    });
  }
}

module.exports = { QAService };
