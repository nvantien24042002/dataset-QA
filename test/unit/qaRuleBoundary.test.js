'use strict';

// Phase 4 — Step 2 boundary tests:
//   1. raw-input → canonical construction boundary for INVALID_BBOX (v2.md
//      §5.6.6, §5.6.8; v1.md §15): a malformed raw bbox becomes a QA finding
//      while canonical geometry stays strict;
//   2. rule descriptors materialize into the Step 1 QAIssue model;
//   3. module boundary of src/domain/qa/rules (v2.md §6.2).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ValidationError } = require('../../src/domain/errors');
const { createBBox, createGeometry, GeometryType } = require('../../src/domain/geometry/Geometry');
const { validateBBox } = require('../../src/domain/geometry/bbox');
const { normalize, normalizeBBox } = require('../../src/infrastructure/coco/CocoNormalizer');
const { createQAIssue } = require('../../src/domain/qa/QAIssue');
const {
  checkImageReferences,
  checkCategoryReferences,
  checkBBoxes,
  checkImageDimensions,
} = require('../../src/domain/qa/rules/recordRules');

const toBBoxFields = ([x, y, width, height]) => ({ x, y, width, height });

// --- 1. Construction boundary ---

test('a malformed raw bbox becomes INVALID_BBOX while canonical construction still rejects it', () => {
  // Values that createBBox() rejects structurally (non-finite / negative size).
  for (const raw of [
    [10, 10, -5, 20],
    [10, 10, 20, -5],
    [10, 10, NaN, 20],
    [10, 10, Infinity, 20],
    [10, 10, 'abc', 20],
  ]) {
    const { issues } = checkBBoxes([{ id: 'a1', imageId: 'i1', categoryId: 1, bbox: raw }]);
    assert.strictEqual(issues.length, 1, JSON.stringify(raw));
    assert.strictEqual(issues[0].type, 'INVALID_BBOX');
    assert.throws(() => createBBox(toBBoxFields(raw)), ValidationError, JSON.stringify(raw));
    assert.throws(
      () => createGeometry({ type: GeometryType.BBOX, bbox: toBBoxFields(raw) }),
      ValidationError
    );
  }
});

test('a wrong-shape raw bbox becomes INVALID_BBOX and never yields a canonical bbox', () => {
  for (const raw of [[10, 10, 20], [10, 10, 20, 20, 5], 'not-an-array']) {
    assert.strictEqual(checkBBoxes([{ id: 'a1', imageId: 'i1', categoryId: 1, bbox: raw }]).issues.length, 1);
    assert.strictEqual(normalizeBBox(raw), null);
  }
});

test('a numeric-looking string bbox is NOT INVALID_BBOX, but createBBox still needs coercion first', () => {
  // v1.md §6.2: the normalized dataset coerces elements with Number() before QA.
  // The rule mirrors that, so "20" is value-valid and yields no issue...
  const raw = [10, 10, '20', '20'];
  assert.deepStrictEqual([...checkBBoxes([{ id: 'a1', imageId: 'i1', categoryId: 1, bbox: raw }]).issues], []);
  // ...while createBBox() stays strict: it rejects the string, so the
  // orchestrator must apply the same Number() coercion before constructing.
  assert.throws(() => createBBox(toBBoxFields(raw)), ValidationError);
  assert.deepStrictEqual({ ...createBBox(toBBoxFields([10, 10, 20, 20])) }, {
    x: 10,
    y: 10,
    width: 20,
    height: 20,
  });
});

test('zero width/height: canonical geometry reports DEGENERATE; QA independently reports INVALID_BBOX', () => {
  // Layering (Decision #9): the geometry fact and the QA severity are separate.
  const geometryFact = validateBBox(createBBox({ x: 10, y: 10, width: 0, height: 20 }));
  assert.strictEqual(geometryFact.status, 'DEGENERATE');
  assert.ok(!('severity' in geometryFact));
  const { issues } = checkBBoxes([{ id: 'a1', imageId: 'i1', categoryId: 1, bbox: [10, 10, 0, 20] }]);
  assert.strictEqual(issues[0].severity, 'HIGH');
});

test('import policy is unchanged: normalize() still rejects a negative-size bbox', () => {
  const dto = {
    images: [{ id: 1, file_name: 'a.png', width: 10, height: 10 }],
    categories: [{ id: 1, name: 'c' }],
    annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [1, 1, -5, 2] }],
  };
  assert.throws(
    () => normalize(dto, { makeImageId: (c) => `img-${c}`, makeAnnotationId: (c) => `ann-${c}` }),
    ValidationError
  );
});

// --- 2. Descriptor → QAIssue materialization ---

test('every Step 2 rule descriptor materializes into a valid QAIssue', () => {
  const descriptors = [
    ...checkImageReferences([{ id: 'a1', imageId: 'missing', categoryId: 1, bbox: null }], new Set(['i1'])).issues,
    ...checkCategoryReferences([{ id: 'a2', imageId: 'i1', categoryId: 99, bbox: null }], new Set([1])).issues,
    ...checkBBoxes([{ id: 'a3', imageId: 'i1', categoryId: 1, bbox: [1, 1, 0, 1] }]).issues,
    ...checkImageDimensions([{ id: 'i1', width: 0, height: 10 }]).issues,
  ];
  assert.strictEqual(descriptors.length, 4);
  descriptors.forEach((descriptor, n) => {
    // The orchestrator (later step) supplies these four fields; rules do not.
    for (const key of ['id', 'qaRunId', 'datasetVersionId', 'createdAt']) {
      assert.ok(!(key in descriptor), `${descriptor.type} must not carry ${key}`);
    }
    const issue = createQAIssue({
      ...descriptor,
      id: `issue-${n}`,
      qaRunId: 'run-1',
      datasetVersionId: 'ver-1',
      createdAt: '2026-10-01T10:00:00.000Z',
    });
    assert.strictEqual(issue.type, descriptor.type);
    assert.strictEqual(issue.severity, 'HIGH');
    assert.strictEqual(issue.imageId, descriptor.imageId);
    assert.deepStrictEqual({ ...issue.details }, { ...descriptor.details });
  });
});

// --- 3. Module boundary ---

test('QA rule modules import only domain errors, QA vocabulary, and dataset reference predicates', () => {
  const rulesDir = path.join(__dirname, '../../src/domain/qa/rules');
  const files = fs.readdirSync(rulesDir).filter((name) => name.endsWith('.js'));
  assert.ok(files.length > 0);
  const allowed = new Set(['../../errors', '../QAVocabulary', '../../dataset/references']);
  for (const file of files) {
    const source = fs.readFileSync(path.join(rulesDir, file), 'utf8');
    const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    for (const spec of requires) {
      assert.ok(allowed.has(spec), `${file} must not require '${spec}'`);
    }
    // Rules inspect raw values; they never construct canonical geometry. The
    // allowlist above already forbids importing it; this also catches a call
    // through any other path. Comment lines are ignored (they may name the API).
    const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    assert.ok(!/\b(createBBox|createGeometry)\s*\(/.test(code), `${file} must not construct geometry`);
  }
});

test('the shared reference predicates module has no dependencies', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/domain/dataset/references.js'), 'utf8');
  assert.deepStrictEqual([...source.matchAll(/require\(/g)], []);
});
