'use strict';

// Phase 5.1 unit test — Review vocabulary enums + validators.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  ReviewStatus,
  ReviewDecision,
  ReviewSource,
  ReviewTargetType,
  isValidStatus,
  isValidDecision,
  isValidSource,
  isValidTargetType,
} = require('../../src/domain/review/ReviewVocabulary');

test('enums expose exactly the SSOT values', () => {
  assert.deepStrictEqual(Object.values(ReviewStatus), ['UNREVIEWED', 'IN_REVIEW', 'REVIEWED']);
  assert.deepStrictEqual(Object.values(ReviewDecision), ['ACCEPT', 'REJECT', 'NEEDS_FIX']);
  assert.deepStrictEqual(Object.values(ReviewSource), ['QA', 'MANUAL']);
  assert.deepStrictEqual(Object.values(ReviewTargetType), ['IMAGE', 'ANNOTATION']);
});

test('enums are frozen', () => {
  assert.ok(Object.isFrozen(ReviewStatus));
  assert.ok(Object.isFrozen(ReviewDecision));
  assert.ok(Object.isFrozen(ReviewSource));
  assert.ok(Object.isFrozen(ReviewTargetType));
});

test('validators accept valid values', () => {
  assert.ok(isValidStatus('UNREVIEWED') && isValidStatus('IN_REVIEW') && isValidStatus('REVIEWED'));
  assert.ok(isValidDecision('ACCEPT') && isValidDecision('REJECT') && isValidDecision('NEEDS_FIX'));
  assert.ok(isValidSource('QA') && isValidSource('MANUAL'));
  assert.ok(isValidTargetType('IMAGE') && isValidTargetType('ANNOTATION'));
});

test('validators reject invalid values', () => {
  for (const bad of ['', 'reviewed', 'DONE', null, undefined, 1, {}]) {
    assert.strictEqual(isValidStatus(bad), false);
    assert.strictEqual(isValidDecision(bad), false);
    assert.strictEqual(isValidSource(bad), false);
    assert.strictEqual(isValidTargetType(bad), false);
  }
  // Cross-enum values are not interchangeable.
  assert.strictEqual(isValidStatus('ACCEPT'), false);
  assert.strictEqual(isValidDecision('UNREVIEWED'), false);
  assert.strictEqual(isValidTargetType('QA'), false);
  assert.strictEqual(isValidSource('IMAGE'), false);
});
