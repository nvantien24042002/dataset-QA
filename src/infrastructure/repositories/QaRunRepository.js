'use strict';

// QaRunRepository (v2.md §14.3 qa_runs, §14.4). Infrastructure layer. All SQL for
// QA runs lives here. The dataset_version_id foreign key (INV-09) is enforced by
// the schema. The QARun status machine (v2.md §22) is enforced by the domain
// model (src/domain/qa/QARun.js); this repository persists its fields and offers
// a guarded status transition mirroring DatasetVersionRepository.updateStatus.

const { BaseRepository } = require('./BaseRepository');
const { assertCanTransition } = require('../../domain/qa/QARun');
const { NotFoundError } = require('../../domain/errors');

class QaRunRepository extends BaseRepository {
  create(run) {
    this.db
      .prepare(
        `INSERT INTO qa_runs
           (id, dataset_version_id, rules_version, status, started_at, completed_at, summary_json)
         VALUES
           (@id, @datasetVersionId, @rulesVersion, @status, @startedAt, @completedAt, @summaryJson)`
      )
      .run({
        id: run.id,
        datasetVersionId: run.datasetVersionId,
        rulesVersion: run.rulesVersion ?? null,
        status: run.status,
        startedAt: run.startedAt ?? null,
        completedAt: run.completedAt ?? null,
        summaryJson: run.summary == null ? null : JSON.stringify(run.summary),
      });
    return this.findById(run.id);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM qa_runs WHERE id = ?').get(id) || null;
  }

  findByVersion(datasetVersionId) {
    return this.db
      .prepare('SELECT * FROM qa_runs WHERE dataset_version_id = ? ORDER BY started_at ASC, id ASC')
      .all(datasetVersionId);
  }

  // Guarded status transition (v2.md §22): PENDING→RUNNING→COMPLETED|FAILED.
  // Illegal transitions throw ConflictError via the domain state machine. Also
  // persists completed_at and (re)serializes summary when supplied.
  updateStatus(id, toStatus, { completedAt = undefined, summary = undefined } = {}) {
    const current = this.findById(id);
    if (!current) throw new NotFoundError('QARun not found', { id });
    assertCanTransition(current.status, toStatus);
    const next = {
      id,
      status: toStatus,
      completedAt: completedAt !== undefined ? completedAt : current.completed_at,
      summaryJson:
        summary !== undefined
          ? summary == null
            ? null
            : JSON.stringify(summary)
          : current.summary_json,
    };
    this.db
      .prepare('UPDATE qa_runs SET status = @status, completed_at = @completedAt, summary_json = @summaryJson WHERE id = @id')
      .run(next);
    return this.findById(id);
  }
}

module.exports = { QaRunRepository };
