'use strict';

// Phase 1 integration test — Dataset & DatasetVersion repositories
// (v2.md §11, §14.3, §14.4). Covers round-trip, INV-01 uniqueness, FK enforcement.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { createDatabase } = require('../../src/infrastructure/persistence/sqlite/db');
const { migrate } = require('../../src/infrastructure/persistence/sqlite/migrate');
const { DatasetRepository } = require('../../src/infrastructure/repositories/DatasetRepository');
const {
  DatasetVersionRepository,
} = require('../../src/infrastructure/repositories/DatasetVersionRepository');

let db;
let datasets;
let versions;

beforeEach(() => {
  db = createDatabase(':memory:');
  migrate(db);
  datasets = new DatasetRepository(db);
  versions = new DatasetVersionRepository(db);
});

afterEach(() => {
  db.close();
});

const now = '2026-09-27T00:00:00.000Z';

test('dataset create + findById round-trips', () => {
  const created = datasets.create({
    id: 'ds-1',
    name: 'Traffic',
    description: 'demo',
    createdAt: now,
    updatedAt: now,
  });
  assert.strictEqual(created.id, 'ds-1');
  assert.strictEqual(created.name, 'Traffic');
  assert.deepStrictEqual(datasets.findById('ds-1'), created);
});

test('dataset version create + findByDataset round-trips', () => {
  datasets.create({ id: 'ds-1', name: 'Traffic', createdAt: now, updatedAt: now });
  versions.create({
    id: 'v-1',
    datasetId: 'ds-1',
    versionNumber: 1,
    parentVersionId: null,
    status: 'DRAFT',
    fingerprint: 'abc',
    createdAt: now,
    createdBy: 'tester',
  });
  const list = versions.findByDataset('ds-1');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].version_number, 1);
  assert.strictEqual(list[0].parent_version_id, null);
});

test('INV-01: UNIQUE(dataset_id, version_number) is enforced', () => {
  datasets.create({ id: 'ds-1', name: 'Traffic', createdAt: now, updatedAt: now });
  versions.create({ id: 'v-1', datasetId: 'ds-1', versionNumber: 1, status: 'READY', createdAt: now });
  assert.throws(
    () =>
      versions.create({ id: 'v-2', datasetId: 'ds-1', versionNumber: 1, status: 'DRAFT', createdAt: now }),
    /UNIQUE/i
  );
});

test('foreign key: version referencing a missing dataset is rejected', () => {
  assert.throws(
    () =>
      versions.create({
        id: 'v-1',
        datasetId: 'does-not-exist',
        versionNumber: 1,
        status: 'DRAFT',
        createdAt: now,
      }),
    /FOREIGN KEY/i
  );
});

test('parent_version_id self-reference resolves to a real version row', () => {
  datasets.create({ id: 'ds-1', name: 'Traffic', createdAt: now, updatedAt: now });
  versions.create({ id: 'v-1', datasetId: 'ds-1', versionNumber: 1, status: 'READY', createdAt: now });
  const child = versions.create({
    id: 'v-2',
    datasetId: 'ds-1',
    versionNumber: 2,
    parentVersionId: 'v-1',
    status: 'DRAFT',
    createdAt: now,
  });
  assert.strictEqual(child.parent_version_id, 'v-1');
});
