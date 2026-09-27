'use strict';

// Phase 2 unit test — DatasetVersion status machine (v2.md §22, INV-05).

const { test } = require('node:test');
const assert = require('node:assert');
const {
  VersionStatus,
  canTransition,
  assertCanTransition,
  isImmutable,
} = require('../../src/domain/version/VersionStatus');

test('DRAFT → READY is allowed', () => {
  assert.strictEqual(canTransition('DRAFT', 'READY'), true);
});

test('READY → ARCHIVED is allowed', () => {
  assert.strictEqual(canTransition('READY', 'ARCHIVED'), true);
});

test('READY → DRAFT is rejected (INV-05 immutability)', () => {
  assert.strictEqual(canTransition('READY', 'DRAFT'), false);
  assert.throws(() => assertCanTransition('READY', 'DRAFT'), /transition/);
});

test('READY and ARCHIVED are immutable; DRAFT is not', () => {
  assert.strictEqual(isImmutable(VersionStatus.READY), true);
  assert.strictEqual(isImmutable(VersionStatus.ARCHIVED), true);
  assert.strictEqual(isImmutable(VersionStatus.DRAFT), false);
});
