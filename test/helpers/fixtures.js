'use strict';

// Shared Phase 2 test helpers: tiny valid image buffers, an in-memory migrated
// DB, and a temp dataset-source builder.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { createDatabase } = require('../../src/infrastructure/persistence/sqlite/db');
const { migrate } = require('../../src/infrastructure/persistence/sqlite/migrate');

// 1x1 PNG and 1x1 JPEG (dimensions readable from headers).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==',
  'base64'
);
const JPEG_1x1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==',
  'base64'
);

function memDb() {
  const db = createDatabase(':memory:');
  migrate(db);
  return db;
}

function tmpDir(prefix = 'dsqa-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Write a COCO import source: <dir>/annotations.json + <dir>/images/*.
function writeDataset(dir, { coco, images }) {
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'annotations.json'), JSON.stringify(coco));
  for (const [name, buf] of Object.entries(images)) {
    fs.writeFileSync(path.join(dir, 'images', name), buf);
  }
  return dir;
}

module.exports = { PNG_1x1, JPEG_1x1, memDb, tmpDir, writeDataset };
