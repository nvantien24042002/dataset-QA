'use strict';

// Phase 3 — Step 1 unit test: Point2D (v2.md §5.2, §5.6.1). Canonical 2D point
// in IMAGE_PIXEL space; x and y MUST be finite numbers.

const { test } = require('node:test');
const assert = require('node:assert');
const { createPoint2D } = require('../../src/domain/geometry/Geometry');

test('createPoint2D accepts finite x, y and preserves them', () => {
  const p = createPoint2D({ x: 12.5, y: -3 });
  assert.deepStrictEqual({ ...p }, { x: 12.5, y: -3 });
});

test('createPoint2D result is frozen (canonical, immutable)', () => {
  const p = createPoint2D({ x: 1, y: 2 });
  assert.strictEqual(Object.isFrozen(p), true);
});

test('createPoint2D rejects NaN', () => {
  assert.throws(() => createPoint2D({ x: NaN, y: 0 }), /finite/);
  assert.throws(() => createPoint2D({ x: 0, y: NaN }), /finite/);
});

test('createPoint2D rejects Infinity', () => {
  assert.throws(() => createPoint2D({ x: Infinity, y: 0 }), /finite/);
  assert.throws(() => createPoint2D({ x: 0, y: Infinity }), /finite/);
});

test('createPoint2D rejects -Infinity', () => {
  assert.throws(() => createPoint2D({ x: -Infinity, y: 0 }), /finite/);
  assert.throws(() => createPoint2D({ x: 0, y: -Infinity }), /finite/);
});

test('createPoint2D rejects non-number coordinate types', () => {
  assert.throws(() => createPoint2D({ x: '1', y: 2 }), /finite/);
  assert.throws(() => createPoint2D({ x: 1, y: null }), /finite/);
  assert.throws(() => createPoint2D({ x: 1, y: undefined }), /finite/);
});
