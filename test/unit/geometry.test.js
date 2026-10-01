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

test('createGeometry structurally canonicalizes supplied segmentations', () => {
  const g = createGeometry({
    type: GeometryType.SEGMENTATION,
    segmentation: { encoding: 'RLE', size: [2, 2], counts: [1, 3] },
  });
  assert.deepStrictEqual([...g.segmentation.size], [2, 2]);
  assert.deepStrictEqual([...g.segmentation.counts], [1, 3]);
  assert.ok(Object.isFrozen(g.segmentation));
  assert.throws(() => createGeometry({ type: GeometryType.SEGMENTATION, segmentation: { size: [2, 2], counts: [1, 3] } }), /encoding/);
});

// --- createGeometry type/content invariants (v2.md §5.6.8 Layer 1, INV-44) ---

test('createGeometry BBOX without a bbox throws', () => {
  assert.throws(() => createGeometry({ type: GeometryType.BBOX }), /BBOX geometry requires a bbox/);
});

test('createGeometry SEGMENTATION without a segmentation throws', () => {
  assert.throws(
    () => createGeometry({ type: GeometryType.SEGMENTATION }),
    /SEGMENTATION geometry requires a segmentation/
  );
});

test('createGeometry POLYGON is reserved and not constructible', () => {
  assert.throws(
    () => createGeometry({
      type: GeometryType.POLYGON,
      segmentation: { encoding: 'POLYGON', polygons: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }]] },
    }),
    /reserved and not constructible/
  );
});

test('createGeometry with neither bbox nor segmentation throws', () => {
  assert.throws(
    () => createGeometry({ type: GeometryType.BBOX, bbox: null, segmentation: null }),
    /requires a bbox/
  );
});

test('createGeometry SEGMENTATION may carry both bbox and segmentation (COCO style)', () => {
  const g = createGeometry({
    type: GeometryType.SEGMENTATION,
    bbox: { x: 0, y: 0, width: 4, height: 2 },
    segmentation: { encoding: 'RLE', size: [2, 2], counts: [1, 3] },
  });
  assert.strictEqual(g.type, GeometryType.SEGMENTATION);
  assert.deepStrictEqual({ ...g.bbox }, { x: 0, y: 0, width: 4, height: 2 });
  assert.strictEqual(g.segmentation.encoding, 'RLE');
});
