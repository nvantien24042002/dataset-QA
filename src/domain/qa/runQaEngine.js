'use strict';

// QA Engine — record-rule orchestrator (Phase 4 Step 3B-3; v1.md §13, §14, §15,
// §16B, §17, §19.4, §29.2). Pure domain: no I/O, no persistence, no QAIssue
// construction. Runs the four committed Step 2 record-level rules over a
// QADatasetView, concatenates their descriptors, exposes the four primitive
// invalid sets for future cascade suppression, and builds a deterministic
// summary.
//
// This step runs ONLY the four record-level rules. Geometric rules (SMALL_OBJECT,
// TRUNCATED, OUT_OF_BOUNDS_BBOX), dataset-level rules (MISSING_ANNOTATION,
// CLASS_IMBALANCE), the risk engine, and persistence are later steps. The four
// invalid sets are exposed as primitives; computing the geometric-suppression
// union is the later gating step's job.
//
// ID policy: the rules apply the single §6.4 normalizeId policy internally; this
// engine passes RAW ids through unchanged and introduces NO second normalization.
// Descriptors stay raw-id based (no id/qaRunId/createdAt); raw->canonical mapping
// and QAIssue materialization belong to the persistence step.

const { QAIssueType, QASeverity } = require('./QAVocabulary');
const {
  checkImageReferences,
  checkCategoryReferences,
  checkBBoxes,
  checkImageDimensions,
} = require('./rules/recordRules');

// QADatasetView -> Step 2 RuleInput. Field RENAME ONLY: raw values pass through
// untouched (including the original raw bbox), no normalization, no canonical-id
// resolution, no persistence mapping. Every annotation is supplied — including
// records with no canonical row — because INVALID_IMAGE_REFERENCE / INVALID_BBOX
// come precisely from those defective records.
function toRuleInput(view) {
  const annotations = view.annotations.map((a) => ({
    id: a.rawId,
    imageId: a.rawImageId,
    categoryId: a.categoryId,
    bbox: a.bbox,
  }));
  const images = view.images.map((img) => ({
    id: img.rawId,
    width: img.width,
    height: img.height,
  }));
  return { annotations, images };
}

const toSet = (ids) => new Set(ids);

// Deterministic severity order (v1.md §19.4): HIGH -> MEDIUM -> LOW -> INFO.
const SEVERITY_ORDER = [QASeverity.HIGH, QASeverity.MEDIUM, QASeverity.LOW, QASeverity.INFO];
// Issue-type order follows the QAIssueType vocabulary declaration order.
const TYPE_ORDER = Object.values(QAIssueType);

function buildSummary(issues) {
  const severityCounts = {};
  for (const severity of SEVERITY_ORDER) severityCounts[severity] = 0;
  const issueTypeCounts = {};
  for (const type of TYPE_ORDER) issueTypeCounts[type] = 0;

  for (const issue of issues) {
    // Rules only ever emit vocabulary-valid types/severities, so these keys
    // always pre-exist; no key is created outside the fixed shape.
    severityCounts[issue.severity] += 1;
    issueTypeCounts[issue.type] += 1;
  }

  return Object.freeze({
    totalIssues: issues.length,
    severityCounts: Object.freeze(severityCounts),
    issueTypeCounts: Object.freeze(issueTypeCounts),
  });
}

// Run the four record-level rules in a fixed order and aggregate. The order is
// deterministic but does not affect descriptor semantics — the rules are
// independent record-level checks (v1.md §29.2 step 2).
function runQaEngine(view) {
  const { annotations, images } = toRuleInput(view);

  const imageRefs = checkImageReferences(annotations, view.imageIds);
  const categoryRefs = checkCategoryReferences(annotations, view.categoryIds);
  const bboxes = checkBBoxes(annotations);
  const dimensions = checkImageDimensions(images);

  const issues = [
    ...imageRefs.issues,
    ...categoryRefs.issues,
    ...bboxes.issues,
    ...dimensions.issues,
  ];

  // Four PRIMITIVE invalid sets, kept separate (v1.md §29.2, §16B, §14): each
  // drives a different future suppression. Fresh Sets; the view's Sets are never
  // mutated.
  const invalidSets = Object.freeze({
    invalidImageReferenceAnnotationIds: toSet(imageRefs.invalidAnnotationIds),
    invalidCategoryReferenceAnnotationIds: toSet(categoryRefs.invalidAnnotationIds),
    invalidBBoxAnnotationIds: toSet(bboxes.invalidAnnotationIds),
    invalidDimensionImageIds: toSet(dimensions.invalidImageIds),
  });

  return Object.freeze({
    issues: Object.freeze(issues),
    invalidSets,
    summary: buildSummary(issues),
  });
}

module.exports = { runQaEngine };
