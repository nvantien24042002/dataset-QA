'use strict';

// Minimal, dependency-free image dimension probe for PNG and JPEG (v2.md §12
// "Validate image dimensions"). Reads only header bytes; it does not decode
// pixels. Supported formats are intentionally limited to the common COCO
// formats (PNG, JPEG); anything else is treated as unreadable so a version
// cannot become READY on images whose dimensions we cannot verify.

const { ValidationError } = require('../../domain/errors');

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function probePng(buf) {
  if (buf.length < 24) return null;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) return null;
  }
  // IHDR is the first chunk; width/height are big-endian uint32 at bytes 16/20.
  return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function isSofMarker(marker) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function probeJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (isSofMarker(marker)) {
      // Frame header: [marker][len:2][precision:1][height:2][width:2]
      return { format: 'jpeg', height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    const segmentLength = buf.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }
  return null;
}

function probeImageDimensions(buffer) {
  const result = probePng(buffer) || probeJpeg(buffer);
  if (!result) {
    throw new ValidationError('Unsupported or unreadable image format (PNG/JPEG only in V2 Phase 2)');
  }
  return result;
}

module.exports = { probeImageDimensions, probePng, probeJpeg };
