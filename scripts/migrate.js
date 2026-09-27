'use strict';

// CLI: create/upgrade the SQLite database at data/app.db (v2.md §14).
// Usage: node scripts/migrate.js   (override path with DB_PATH env var)

const path = require('path');
const { createDatabase } = require('../src/infrastructure/persistence/sqlite/db');
const { migrate } = require('../src/infrastructure/persistence/sqlite/migrate');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');

const db = createDatabase(dbPath);
migrate(db);
// eslint-disable-next-line no-console
console.log(`Database migrated: ${dbPath}`);
db.close();
