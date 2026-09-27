'use strict';

// BaseRepository — shared data-access helpers over a better-sqlite3 connection
// (v2.md §14.4: Service → Repository → SQLite). All SQL lives in the repository
// (infrastructure) layer; application/domain never touch SQL directly.

class BaseRepository {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    if (!db) {
      throw new Error('BaseRepository requires a database connection');
    }
    this.db = db;
  }

  /** Run a business operation as a single atomic transaction. */
  transaction(fn) {
    return this.db.transaction(fn)();
  }
}

module.exports = { BaseRepository };
