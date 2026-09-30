'use strict';

const { ValidationError } = require('../errors');
const { SegmentationEncoding } = require('./Geometry');
const { GeometryValidationStatus, GeometryIssueCode } = require('./validation');

const invalidResult = () => Object.freeze({
  status: GeometryValidationStatus.INVALID,
  issues: Object.freeze([Object.freeze({ code: GeometryIssueCode.INVALID_RLE })]),
  mask: null,
});

function assertCanonicalRle(rle) {
  if (!rle || typeof rle !== 'object' || rle.encoding !== SegmentationEncoding.RLE
    || !Array.isArray(rle.size) || rle.size.length !== 2
    || !rle.size.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
    || (typeof rle.counts !== 'string' && !Array.isArray(rle.counts))
    || (Array.isArray(rle.counts) && !rle.counts.every((value) => typeof value === 'number'))) {
    throw new ValidationError('decodeRle requires a canonical RLE segmentation', { rle });
  }
}

function decodeCompressedCounts(counts) {
  const result = [];
  let index = 0;
  while (index < counts.length) {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      if (index >= counts.length || shift > 50) return null;
      byte = counts.charCodeAt(index) - 48;
      index += 1;
      if (byte < 0 || byte > 63) return null;
      value += (byte & 0x1f) * (2 ** shift);
      if (!Number.isSafeInteger(value)) return null;
      shift += 5;
    } while (byte & 0x20);
    if (byte & 0x10) value -= 2 ** shift;
    if (result.length > 2) value += result[result.length - 2];
    if (!Number.isSafeInteger(value) || value < 0) return null;
    result.push(value);
  }
  return result;
}

function decodeRle(canonicalRle) {
  assertCanonicalRle(canonicalRle);
  const [height, width] = canonicalRle.size;
  const pixelCount = height * width;
  if (!Number.isSafeInteger(pixelCount)) return invalidResult();
  const runs = typeof canonicalRle.counts === 'string'
    ? decodeCompressedCounts(canonicalRle.counts)
    : canonicalRle.counts;
  if (!runs || !runs.every((run) => Number.isSafeInteger(run) && run >= 0)) return invalidResult();

  const data = new Uint8Array(pixelCount);
  let offset = 0;
  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const run = runs[runIndex];
    if (run > pixelCount - offset) return invalidResult();
    if (runIndex % 2 === 1) {
      for (let i = offset; i < offset + run; i += 1) {
        const x = Math.floor(i / height);
        const y = i % height;
        data[y * width + x] = 1;
      }
    }
    offset += run;
  }
  if (offset !== pixelCount) return invalidResult();
  return Object.freeze({
    status: GeometryValidationStatus.VALID,
    issues: Object.freeze([]),
    mask: Object.freeze({ height, width, data }),
  });
}

module.exports = { decodeRle };
