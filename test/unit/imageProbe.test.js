'use strict';

// Phase 2 unit test — dependency-free image dimension probe (v2.md §12).

const { test } = require('node:test');
const assert = require('node:assert');
const { probeImageDimensions } = require('../../src/infrastructure/filesystem/imageProbe');
const { PNG_1x1, JPEG_1x1 } = require('../helpers/fixtures');

test('reads PNG dimensions from the IHDR chunk', () => {
  assert.deepStrictEqual(probeImageDimensions(PNG_1x1), { format: 'png', width: 1, height: 1 });
});

test('reads JPEG dimensions from the SOF frame header', () => {
  const r = probeImageDimensions(JPEG_1x1);
  assert.strictEqual(r.format, 'jpeg');
  assert.strictEqual(r.width, 1);
  assert.strictEqual(r.height, 1);
});

test('throws on an unsupported/unreadable format', () => {
  assert.throws(() => probeImageDimensions(Buffer.from('not an image')), /Unsupported|unreadable/i);
});
