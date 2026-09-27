'use strict';

// Phase 2 unit test — canonical geometry structures (v2.md §5). Data only; no
// geometric algorithms (Phase 3).

const { test } = require('node:test');
const assert = require('node:assert');
const {
  createBBox,
  createGeometry,
  createSegmentationPolygon,
  createSegmentationRle,
  GeometryType,
} = require('../../src/domain/geometry/Geometry');

test('createBBox preserves x, y, width, height', () => {
  const b = createBBox({ x: 1, y: 2, width: 3, height: 4 });
  assert.deepStrictEqual({ ...b }, { x: 1, y: 2, width: 3, height: 4 });
});

test('createBBox rejects non-finite values', () => {
  assert.throws(() => createBBox({ x: NaN, y: 0, width: 1, height: 1 }), /finite/);
});

test('createGeometry BBOX is a composite in IMAGE_PIXEL space', () => {
  const g = createGeometry({ type: GeometryType.BBOX, bbox: { x: 0, y: 0, width: 2, height: 2 } });
  assert.strictEqual(g.type, 'BBOX');
  assert.strictEqual(g.coordinateSpace, 'IMAGE_PIXEL');
  assert.strictEqual(g.segmentation, null);
});

test('polygon segmentation has POLYGON encoding and rings of points', () => {
  const s = createSegmentationPolygon([[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]]);
  assert.strictEqual(s.encoding, 'POLYGON');
  assert.strictEqual(s.polygons[0].length, 3);
});

test('RLE segmentation preserves counts/size and does not decode (INV-31)', () => {
  const s = createSegmentationRle({ size: [2, 2], counts: 'abc' });
  assert.strictEqual(s.encoding, 'RLE');
  assert.strictEqual(s.counts, 'abc');
  assert.deepStrictEqual([...s.size], [2, 2]);
});
