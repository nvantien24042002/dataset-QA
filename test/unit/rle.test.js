'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { ValidationError } = require('../../src/domain/errors');
const { createSegmentationRle } = require('../../src/domain/geometry/Geometry');
const { decodeRle } = require('../../src/domain/geometry/rle');
const { GeometryValidationStatus, GeometryIssueCode } = require('../../src/domain/geometry/validation');

test('decodes numeric COCO runs into a row-major runtime mask', () => {
  const rle = createSegmentationRle({ size: [2, 3], counts: [1, 3, 2] });
  const result = decodeRle(rle);
  assert.strictEqual(result.status, GeometryValidationStatus.VALID);
  assert.deepStrictEqual([...result.mask.data], [0, 1, 0, 1, 1, 0]);
  assert.strictEqual(result.mask.height, 2);
  assert.strictEqual(result.mask.width, 3);
  assert.ok(!('mask' in rle));
});

test('decodes compressed COCO counts including differential encoding', () => {
  const result = decodeRle(createSegmentationRle({ size: [2, 2], counts: '0120' }));
  assert.strictEqual(result.status, GeometryValidationStatus.VALID);
  assert.deepStrictEqual([...result.mask.data], [1, 0, 0, 1]);
});

test('invalid runtime counts yield INVALID_RLE without mutating canonical RLE', () => {
  const rle = createSegmentationRle({ size: [2, 2], counts: [1, 2] });
  const result = decodeRle(rle);
  assert.strictEqual(result.status, GeometryValidationStatus.INVALID);
  assert.strictEqual(result.issues[0].code, GeometryIssueCode.INVALID_RLE);
  assert.strictEqual(result.mask, null);
  assert.deepStrictEqual([...rle.counts], [1, 2]);
  assert.ok(!('mask' in rle));
});

test('rejects malformed, unterminated, undershooting, overshooting, and unsafe runtime runs', () => {
  for (const counts of ['~', 'P', [5], [1, 1], [-1, 5], [1.5, 2.5], [Number.MAX_SAFE_INTEGER + 1]]) {
    const result = decodeRle(createSegmentationRle({ size: [2, 2], counts }));
    assert.strictEqual(result.status, GeometryValidationStatus.INVALID, String(counts));
    assert.strictEqual(result.issues[0].code, GeometryIssueCode.INVALID_RLE);
  }
});

test('decoder structural misuse throws ValidationError', () => {
  assert.throws(() => decodeRle({ encoding: 'RLE', size: [2, 2], counts: [4, 'x'] }), ValidationError);
});
