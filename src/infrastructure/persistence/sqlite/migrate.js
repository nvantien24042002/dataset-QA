'use strict';

// Schema migration (v2.md §12 "Persist", §14). Applies schema.sql to a
// connection. Idempotent: schema.sql uses CREATE ... IF NOT EXISTS.

const path = require('path');
const fs = require('fs');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/**
 * Create all V2 tables and indexes on the given connection.
 * @param {import('better-sqlite3').Database} db
 * @returns {import('better-sqlite3').Database} the same connection
 */
function migrate(db) {
  if (!db) {
    throw new Error('migrate requires a database connection');
  }
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  return db;
}

module.exports = { migrate, SCHEMA_PATH };
