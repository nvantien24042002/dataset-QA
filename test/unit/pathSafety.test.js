'use strict';

// Phase 2 security regression test — imported image file-name path safety
// (INV-08). An imported file_name must be a relative path that stays inside the
// version's images/ root; traversal and absolute paths are rejected.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  assertSafeRelativePath,
  assertWithinDir,
} = require('../../src/domain/dataset/pathSafety');

test('rejects ../../evil.png (parent traversal)', () => {
  assert.throws(() => assertSafeRelativePath('../../evil.png', 'file_name'), /traversal/);
});

test('rejects ../../../evil.png (deep parent traversal)', () => {
  assert.throws(() => assertSafeRelativePath('../../../evil.png', 'file_name'), /traversal/);
});

test('rejects ..\\..\\evil.png (Windows-separator traversal)', () => {
  assert.throws(() => assertSafeRelativePath('..\\..\\evil.png', 'file_name'), /traversal/);
});

test('rejects an absolute Windows path', () => {
  assert.throws(() => assertSafeRelativePath('C:\\Windows\\evil.png', 'file_name'), /absolute/);
});

test('rejects a POSIX absolute path', () => {
  assert.throws(() => assertSafeRelativePath('/etc/passwd', 'file_name'), /absolute/);
});

test('accepts a normal file name', () => {
  assert.strictEqual(assertSafeRelativePath('image.jpg', 'file_name'), 'image.jpg');
});

test('accepts a nested relative path', () => {
  assert.strictEqual(assertSafeRelativePath('nested/path/image.jpg', 'file_name'), 'nested/path/image.jpg');
});

test('assertWithinDir keeps a normal name under the version image root', () => {
  assert.strictEqual(assertWithinDir('images', 'front/car.png', 'file_name'), 'images/front/car.png');
});

test('assertWithinDir rejects a path that escapes the version image root', () => {
  assert.throws(() => assertWithinDir('images', '../../evil.png', 'file_name'), /traversal|escapes/);
});
