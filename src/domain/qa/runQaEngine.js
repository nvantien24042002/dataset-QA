'use strict';

// QA Engine — record + geometric rule orchestrator (Phase 4 Step 3B-3 record
// rules; geometric wiring; v1.md §10, §11, §13, §14, §15, §16, §16B, §17, §19.4,
// §29.2). Pure domain: no I/O, no persistence, no QAIssue construction. Runs the
// four record-level rules, then the three geometric rules over the annotations
// that survive geometry eligibility, concatenates all descriptors, exposes the
// four primitive invalid sets, and builds a deterministic summary.
//
// Execution order (v1.md §29.2): record-level (step 2) before geometric
// (step 3). Geometric rules run ONLY for annotations that passed geometry
// eligibility (valid image reference, valid dimensions, valid bbox); a
// category-reference-invalid annotation is still eligible (v1.md §14). The
// MISSING_ANNOTATION / CLASS_IMBALANCE dataset rules, the risk engine, and
// persistence remain later steps.
//
// ID policy: the record rules apply the single §6.4 normalizeId policy
// internally and geometry eligibility bridges dimension suppression through the
// view's canonicalImageId; this engine introduces NO second normalization and
// constructs no canonical ids. Descriptors stay raw-id based (no id/qaRunId/
// createdAt); raw->canonical mapping and QAIssue materialization belong to the
// persistence step.

const { QAIssueType, QASeverity } = require('./QAVocabulary');
const {
  checkImageReferences,
  checkCategoryReferences,
  checkBBoxes,
  checkImageDimensions,
} = require('./rules/recordRules');
const { geometryIneligibleAnnotationIds } = require('./geometryEligibility');
const {
  checkSmallObjects,
  checkTruncatedObjects,
  checkOutOfBoundsBboxes,
} = require('./rules/geometricRules');

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

// Run the four record-level rules then the three geometric rules in a fixed
// deterministic order (v1.md §29.2: record step 2 before geometric step 3) and
// aggregate.
function runQaEngine(view) {
  const { annotations, images } = toRuleInput(view);

  // --- Record-level phase (step 2) ---
  const imageRefs = checkImageReferences(annotations, view.imageIds);
  const categoryRefs = checkCategoryReferences(annotations, view.categoryIds);
  const bboxes = checkBBoxes(annotations);
  const dimensions = checkImageDimensions(images);

  // Four PRIMITIVE invalid sets, kept separate (v1.md §29.2, §16B, §14): each
  // drives a different suppression. Fresh Sets; the view's Sets are never mutated.
  const invalidSets = Object.freeze({
    invalidImageReferenceAnnotationIds: toSet(imageRefs.invalidAnnotationIds),
    invalidCategoryReferenceAnnotationIds: toSet(categoryRefs.invalidAnnotationIds),
    invalidBBoxAnnotationIds: toSet(bboxes.invalidAnnotationIds),
    invalidDimensionImageIds: toSet(dimensions.invalidImageIds),
  });

  // --- Geometric phase (step 3) ---
  // Eligibility is derived once from the record-phase invalid sets by the
  // committed helper (no re-derivation, no second normalization). A
  // category-reference-invalid annotation stays eligible (the gate never reads
  // that set); dangling-image / invalid-bbox / invalid-dimension-image
  // annotations are excluded. Null-bbox annotations stay eligible here and are
  // skipped inside the geometric rules themselves — the engine does not filter on
  // bbox presence. The geometric rules consume the view shape directly
  // (rawId/rawImageId/categoryId/bbox + images' canonicalId/width/height), so
  // correct gating makes their unresolved-image ValidationError unreachable.
  const ineligible = geometryIneligibleAnnotationIds(view, invalidSets);
  const eligibleAnnotations = view.annotations.filter((a) => !ineligible.has(a.rawId));

  const smallObjects = checkSmallObjects(eligibleAnnotations);
  const truncated = checkTruncatedObjects(eligibleAnnotations, view.images);
  const outOfBounds = checkOutOfBoundsBboxes(eligibleAnnotations, view.images);

  // Deterministic order: record block (image-ref, category-ref, bbox, dimension)
  // then geometric block (small, truncated, out-of-bounds). No deduplication.
  const issues = [
    ...imageRefs.issues,
    ...categoryRefs.issues,
    ...bboxes.issues,
    ...dimensions.issues,
    ...smallObjects.issues,
    ...truncated.issues,
    ...outOfBounds.issues,
  ];

  return Object.freeze({
    issues: Object.freeze(issues),
    invalidSets,
    summary: buildSummary(issues),
  });
}

module.exports = { runQaEngine };
