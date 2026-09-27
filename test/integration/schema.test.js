'use strict';

// Phase 1 integration test — SQLite schema & migration (v2.md §14.2–14.4).

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { createDatabase } = require('../../src/infrastructure/persistence/sqlite/db');
const { migrate } = require('../../src/infrastructure/persistence/sqlite/migrate');

const EXPECTED_TABLES = [
  'datasets',
  'dataset_versions',
  'images',
  'annotations',
  'qa_runs',
  'qa_issues',
  'review_items',
  'review_item_issues',
  'review_history',
  'audit_events',
  'export_jobs',
  'export_artifacts',
];

let db;

beforeEach(() => {
  db = createDatabase(':memory:');
  migrate(db);
});

afterEach(() => {
  db.close();
});

test('migration creates all 12 V2 tables', () => {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((r) => r.name);
  for (const table of EXPECTED_TABLES) {
    assert.ok(rows.includes(table), `missing table: ${table}`);
  }
  assert.strictEqual(rows.length, EXPECTED_TABLES.length);
});

test('foreign_keys pragma is ON', () => {
  assert.strictEqual(db.pragma('foreign_keys', { simple: true }), 1);
});

test('recommended indexes are present', () => {
  const indexes = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'`)
    .all()
    .map((r) => r.name);
  assert.ok(indexes.includes('idx_qa_issues_version_severity'));
  assert.ok(indexes.includes('idx_review_items_version_status'));
  assert.ok(indexes.includes('idx_annotations_version_image'));
});

test('migration is idempotent', () => {
  assert.doesNotThrow(() => migrate(db));
});
