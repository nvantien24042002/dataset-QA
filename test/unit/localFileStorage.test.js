'use strict';

// Phase 1 unit test — LocalFileStorage (v2.md §14.1, INV-08/26/27).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { LocalFileStorage } = require('../../src/infrastructure/filesystem/LocalFileStorage');

let baseDir;
let storage;

before(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsqa-fs-'));
  storage = new LocalFileStorage(baseDir);
});

after(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

test('save then read round-trips content', () => {
  storage.save('datasets/d1/versions/v1/source/annotations.json', '{"ok":true}');
  assert.strictEqual(storage.exists('datasets/d1/versions/v1/source/annotations.json'), true);
  assert.strictEqual(
    storage.read('datasets/d1/versions/v1/source/annotations.json').toString('utf8'),
    '{"ok":true}'
  );
});

test('delete removes the file and is a no-op when absent', () => {
  storage.save('a/b.txt', 'x');
  storage.delete('a/b.txt');
  assert.strictEqual(storage.exists('a/b.txt'), false);
  assert.doesNotThrow(() => storage.delete('a/b.txt'));
});

test('rejects absolute paths', () => {
  const abs = path.resolve(baseDir, 'x.txt');
  assert.throws(() => storage.save(abs, 'x'), /must be relative/);
});

test('rejects paths that escape the storage root', () => {
  assert.throws(() => storage.read('../outside.txt'), /escapes the storage root/);
});

test('rejects empty path', () => {
  assert.throws(() => storage.exists(''), /non-empty string/);
});
