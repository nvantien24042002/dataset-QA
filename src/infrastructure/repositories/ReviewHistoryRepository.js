'use strict';

// ReviewHistoryRepository (v2.md §8.2, §14.3 review_history). Infrastructure
// layer: all SQL for review history lives here. The table is APPEND-ONLY
// (INV-17) — this repository deliberately exposes no update/delete method.
//
// Foreign keys (review_item_id, dataset_version_id) are enforced by the schema.
// Cross-version consistency (history.datasetVersionId === ReviewItem's version)
// is NOT a DB/repository concern; the submit/application layer guarantees it.

const { BaseRepository } = require('./BaseRepository');

class ReviewHistoryRepository extends BaseRepository {
  create(history) {
    this.db
      .prepare(
        `INSERT INTO review_history
           (id, review_item_id, dataset_version_id, review_round, status, decision,
            note, reviewer_id, reviewer_name, timestamp)
         VALUES
           (@id, @reviewItemId, @datasetVersionId, @reviewRound, @status, @decision,
            @note, @reviewerId, @reviewerName, @timestamp)`
      )
      .run({
        id: history.id,
        reviewItemId: history.reviewItemId,
        datasetVersionId: history.datasetVersionId,
        reviewRound: history.reviewRound,
        status: history.status,
        decision: history.decision ?? null,
        note: history.note ?? null,
        reviewerId: history.reviewerId ?? null,
        reviewerName: history.reviewerName ?? null,
        timestamp: history.timestamp,
      });
    return this.findById(history.id);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM review_history WHERE id = ?').get(id) || null;
  }

  findByReviewItem(reviewItemId) {
    return this.db
      .prepare(
        `SELECT * FROM review_history
          WHERE review_item_id = ?
          ORDER BY review_round ASC, timestamp ASC, id ASC`
      )
      .all(reviewItemId);
  }

  findByVersion(datasetVersionId) {
    return this.db
      .prepare(
        `SELECT * FROM review_history
          WHERE dataset_version_id = ?
          ORDER BY timestamp ASC, id ASC`
      )
      .all(datasetVersionId);
  }
}

module.exports = { ReviewHistoryRepository };
