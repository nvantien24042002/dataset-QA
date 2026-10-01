'use strict';

// Phase 4 — Step 1 unit test: QA vocabulary (v2.md §6.1; v1.md §18) and the QA
// domain boundary (v2.md §6.2: QA must not depend on Express, HTTP, SQLite,
// ReviewItem, Reviewer, or Browser UI).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  QAIssueType,
  QASeverity,
  QASeverityRank,
  isValidIssueType,
  isValidSeverity,
} = require('../../src/domain/qa/QAVocabulary');

test('QAIssueType contains exactly the nine V1 rules preserved by V2', () => {
  assert.deepStrictEqual(Object.values(QAIssueType).sort(), [
    'CLASS_IMBALANCE',
    'INVALID_BBOX',
    'INVALID_CATEGORY_REFERENCE',
    'INVALID_IMAGE_DIMENSION',
    'INVALID_IMAGE_REFERENCE',
    'MISSING_ANNOTATION',
    'OUT_OF_BOUNDS_BBOX',
    'SMALL_OBJECT',
    'TRUNCATED',
  ]);
});

test('QASeverity contains INFO, LOW, MEDIUM, HIGH (LOW reserved)', () => {
  assert.deepStrictEqual(Object.values(QASeverity).sort(), ['HIGH', 'INFO', 'LOW', 'MEDIUM']);
});

test('QASeverityRank orders HIGH > MEDIUM > LOW > INFO (v1.md §18)', () => {
  assert.deepStrictEqual({ ...QASeverityRank }, { HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 });
});

test('every severity has a rank', () => {
  for (const severity of Object.values(QASeverity)) {
    assert.strictEqual(typeof QASeverityRank[severity], 'number', severity);
  }
});

test('vocabulary enums are frozen', () => {
  assert.ok(Object.isFrozen(QAIssueType));
  assert.ok(Object.isFrozen(QASeverity));
  assert.ok(Object.isFrozen(QASeverityRank));
});

test('isValidIssueType accepts known types and rejects others', () => {
  assert.strictEqual(isValidIssueType('SMALL_OBJECT'), true);
  assert.strictEqual(isValidIssueType('small_object'), false);
  assert.strictEqual(isValidIssueType('ZERO_AREA'), false); // geometry code, not a QA type
  assert.strictEqual(isValidIssueType(undefined), false);
});

test('isValidSeverity accepts known severities and rejects others', () => {
  assert.strictEqual(isValidSeverity('LOW'), true);
  assert.strictEqual(isValidSeverity('CRITICAL'), false);
  assert.strictEqual(isValidSeverity(null), false);
});

test('QA domain modules import only domain code', () => {
  const qaDir = path.join(__dirname, '../../src/domain/qa');
  const files = fs.readdirSync(qaDir).filter((name) => name.endsWith('.js'));
  assert.ok(files.length > 0);
  const allowed = new Set(['../errors', './QAVocabulary']);
  for (const file of files) {
    const source = fs.readFileSync(path.join(qaDir, file), 'utf8');
    const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    for (const spec of requires) {
      assert.ok(allowed.has(spec), `${file} must not require '${spec}'`);
    }
  }
});
