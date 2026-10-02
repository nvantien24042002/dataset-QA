'use strict';

// QaIssueRepository (v2.md §14.3 qa_issues, §14.4). Infrastructure layer. All SQL
// for QA issues lives here. Foreign keys (qa_run_id, dataset_version_id, nullable
// image_id/annotation_id) are enforced by the schema (INV-09/INV-10 support).
// details is persisted as JSON (details_json); the stored JSON is not the domain
// representation — it is rehydrated by higher layers when needed.

const { BaseRepository } = require('./BaseRepository');

class QaIssueRepository extends BaseRepository {
  create(issue) {
    this.db
      .prepare(
        `INSERT INTO qa_issues
           (id, qa_run_id, dataset_version_id, type, severity, image_id, annotation_id,
            category_id, reason, details_json, created_at)
         VALUES
           (@id, @qaRunId, @datasetVersionId, @type, @severity, @imageId, @annotationId,
            @categoryId, @reason, @detailsJson, @createdAt)`
      )
      .run({
        id: issue.id,
        qaRunId: issue.qaRunId,
        datasetVersionId: issue.datasetVersionId,
        type: issue.type,
        severity: issue.severity,
        imageId: issue.imageId ?? null,
        annotationId: issue.annotationId ?? null,
        categoryId: issue.categoryId ?? null,
        reason: issue.reason ?? null,
        detailsJson: issue.details == null ? null : JSON.stringify(issue.details),
        createdAt: issue.createdAt,
      });
    return this.findById(issue.id);
  }

  createMany(issues) {
    for (const issue of issues) this.create(issue);
    return issues.length;
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM qa_issues WHERE id = ?').get(id) || null;
  }

  findByRun(qaRunId) {
    return this.db
      .prepare('SELECT * FROM qa_issues WHERE qa_run_id = ? ORDER BY created_at ASC, id ASC')
      .all(qaRunId);
  }

  findByVersion(datasetVersionId) {
    return this.db
      .prepare('SELECT * FROM qa_issues WHERE dataset_version_id = ? ORDER BY created_at ASC, id ASC')
      .all(datasetVersionId);
  }
}

module.exports = { QaIssueRepository };
