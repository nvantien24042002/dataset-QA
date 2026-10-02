'use strict';

// Dataset-level QA rules (Phase 4; v1.md §8, §9 MISSING_ANNOTATION, §12
// CLASS_IMBALANCE). Pure domain: no I/O, no persistence, no QAIssue
// construction. Each rule consumes the QADatasetView (plus, for class imbalance,
// plain category metadata and the category-reference-invalid annotation ids) and
// returns Step-2-style raw issue descriptors.
//
// These two rules are dataset/image-level and INDEPENDENT of the geometric
// cascade — they never consult geometry eligibility or the image/bbox/dimension
// invalid sets. CLASS_IMBALANCE uses ONLY invalidCategoryAnnotationIds to drop
// dangling-category annotations from the class distribution (v1.md §8.1, §14).
//
// ID policy: category grouping uses the single §6.4 normalizeId policy (so
// category 1 and "1" are one class); descriptors carry RAW ids (image.rawId /
// winning category rawId); no canonical ids, no QAIssue.

const { QAIssueType, QASeverity } = require('../QAVocabulary');
const { normalizeId } = require('../../dataset/references');

const frozenIssues = (issues) => Object.freeze({ issues: Object.freeze(issues) });

// Freeze a descriptor and its details, matching the record/geometric rule shape.
function frozenDescriptor(descriptor) {
  return Object.freeze({ ...descriptor, details: Object.freeze(descriptor.details) });
}

// --- MISSING_ANNOTATION (v1.md §9) ---

// An annotation attaches to an image iff its resolved image identity equals the
// image's (view bridge: canonicalImageId === canonicalId). bbox/category validity
// and geometry eligibility are irrelevant (v1.md §6.1). A dangling-image
// annotation (canonicalImageId null, or pointing elsewhere) attaches to nothing.
function checkMissingAnnotations(view) {
  const attachedCount = new Map();
  for (const image of view.images) attachedCount.set(image.canonicalId, 0);
  for (const annotation of view.annotations) {
    const key = annotation.canonicalImageId;
    if (key !== null && attachedCount.has(key)) {
      attachedCount.set(key, attachedCount.get(key) + 1);
    }
  }

  const issues = [];
  for (const image of view.images) {
    if (attachedCount.get(image.canonicalId) === 0) {
      issues.push(
        frozenDescriptor({
          type: QAIssueType.MISSING_ANNOTATION,
          severity: QASeverity.INFO,
          imageId: image.rawId,
          annotationId: null,
          categoryId: null,
          reason:
            `Image ${image.fileName != null ? `'${image.fileName}' ` : ''}has no annotations. ` +
            'This may be a missed label or a valid negative sample; please check.',
          details: { annotationCount: 0 },
        })
      );
    }
  }
  return frozenIssues(issues);
}

// --- CLASS_IMBALANCE (v1.md §8, §12) ---

function imbalanceReason(name, pct) {
  return (
    `Class '${name}' holds ${pct}% of annotations. This is a WARNING SIGNAL of imbalance, ` +
    'NOT proof the dataset is bad — it may be appropriate for the real-world task; please check.'
  );
}

// Dataset-level, at most one issue. Only annotations whose category resolves to a
// known category AND whose raw id is not category-invalid contribute. maxPct is
// the UNROUNDED largest-class percentage; threshold: >50 HIGH, >30 MEDIUM, else
// none (no LOW). Ties broken by count desc then name A->Z.
function checkClassImbalance(view, { invalidCategoryAnnotationIds, categories }) {
  // Known categories keyed by normalized id → { rawId, name }.
  const categoryByNorm = new Map();
  for (const category of categories) {
    categoryByNorm.set(normalizeId(category.rawId), { rawId: category.rawId, name: category.name });
  }

  const counts = new Map(); // normalized category id -> count
  let totalValidAnnotations = 0;
  for (const annotation of view.annotations) {
    if (invalidCategoryAnnotationIds.has(annotation.rawId)) continue; // dangling category
    const key = normalizeId(annotation.categoryId);
    if (!categoryByNorm.has(key)) continue; // category does not resolve
    counts.set(key, (counts.get(key) || 0) + 1);
    totalValidAnnotations += 1;
  }

  if (totalValidAnnotations === 0) return frozenIssues([]);

  // Winner: count desc, then name A->Z (deterministic, name-based tie-break).
  let winner = null;
  for (const [key, count] of counts) {
    const { rawId, name } = categoryByNorm.get(key);
    if (
      winner === null ||
      count > winner.count ||
      (count === winner.count && String(name) < String(winner.name))
    ) {
      winner = { key, rawId, name, count };
    }
  }

  const maxPct = (winner.count / totalValidAnnotations) * 100; // UNROUNDED
  if (maxPct <= 30) return frozenIssues([]);
  const severity = maxPct > 50 ? QASeverity.HIGH : QASeverity.MEDIUM;

  return frozenIssues([
    frozenDescriptor({
      type: QAIssueType.CLASS_IMBALANCE,
      severity,
      imageId: null,
      annotationId: null,
      categoryId: winner.rawId, // RAW winning category id
      reason: imbalanceReason(winner.name, maxPct),
      details: { largestClass: winner.name, largestClassPercentage: maxPct },
    }),
  ]);
}

module.exports = { checkMissingAnnotations, checkClassImbalance };
