'use strict';

// SQLite connection factory (v2.md §14 — Storage). Infrastructure layer only.
// Enables foreign key enforcement (v2.md §14.4: PRAGMA foreign_keys = ON).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

/**
 * Open a better-sqlite3 database connection.
 * @param {string} dbPath - file path, or ':memory:' for an in-memory DB (tests).
 * @returns {import('better-sqlite3').Database}
 */
function createDatabase(dbPath) {
  if (!dbPath) {
    throw new Error('createDatabase requires a database path');
  }

  const isMemory = dbPath === ':memory:';
  if (!isMemory) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  if (!isMemory) {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');
  return db;
}

module.exports = { createDatabase };
