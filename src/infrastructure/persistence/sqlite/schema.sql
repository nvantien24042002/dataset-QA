-- V2 SQLite schema (v2.md §14.2, §14.3, §14.4).
-- Applied by src/infrastructure/persistence/sqlite/migrate.js. Idempotent
-- (CREATE ... IF NOT EXISTS). PRAGMA foreign_keys is enabled on the connection
-- in db.js, not here.
--
-- ID strategy (types are unspecified in v2.md): entity primary keys are
-- application-generated TEXT identifiers; category_id holds the COCO numeric
-- class id (INTEGER). Timestamps are ISO-8601 TEXT.

CREATE TABLE IF NOT EXISTS datasets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_versions (
  id                TEXT PRIMARY KEY,
  dataset_id        TEXT NOT NULL REFERENCES datasets(id),
  version_number    INTEGER NOT NULL,
  parent_version_id TEXT REFERENCES dataset_versions(id),
  status            TEXT NOT NULL,
  fingerprint       TEXT,
  created_at        TEXT NOT NULL,
  created_by        TEXT,
  UNIQUE (dataset_id, version_number)
);

CREATE TABLE IF NOT EXISTS images (
  id                 TEXT PRIMARY KEY,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id),
  file_name          TEXT NOT NULL,
  relative_path      TEXT NOT NULL,
  width              INTEGER,
  height             INTEGER,
  fingerprint        TEXT
);

CREATE TABLE IF NOT EXISTS annotations (
  id                 TEXT PRIMARY KEY,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id),
  image_id           TEXT NOT NULL REFERENCES images(id),
  category_id        INTEGER,
  category_name      TEXT,
  geometry_type      TEXT,
  bbox_json          TEXT,
  segmentation_json  TEXT,
  attributes_json    TEXT,
  metadata_json      TEXT
);

CREATE TABLE IF NOT EXISTS qa_runs (
  id                 TEXT PRIMARY KEY,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id),
  rules_version      TEXT,
  status             TEXT NOT NULL,
  started_at         TEXT,
  completed_at       TEXT,
  summary_json       TEXT
);

CREATE TABLE IF NOT EXISTS qa_issues (
  id                 TEXT PRIMARY KEY,
  qa_run_id          TEXT NOT NULL REFERENCES qa_runs(id),
  dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id),
  type               TEXT NOT NULL,
  severity           TEXT NOT NULL,
  image_id           TEXT REFERENCES images(id),
  annotation_id      TEXT REFERENCES annotations(id),
  category_id        INTEGER,
  reason             TEXT,
  details_json       TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_items (
  id                 TEXT PRIMARY KEY,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id),
  target_type        TEXT NOT NULL,
  image_id           TEXT REFERENCES images(id),
  annotation_id      TEXT REFERENCES annotations(id),
  source             TEXT NOT NULL,
  status             TEXT NOT NULL,
  decision           TEXT,
  reviewer_id        TEXT,
  reviewer_name      TEXT,
  note               TEXT,
  review_round       INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_item_issues (
  review_item_id TEXT NOT NULL REFERENCES review_items(id),
  qa_issue_id    TEXT NOT NULL REFERENCES qa_issues(id),
  PRIMARY KEY (review_item_id, qa_issue_id)
);

CREATE TABLE IF NOT EXISTS review_history (
  id                 TEXT PRIMARY KEY,
  review_item_id     TEXT NOT NULL REFERENCES review_items(id),
  dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id),
  review_round       INTEGER NOT NULL,
  status             TEXT NOT NULL,
  decision           TEXT,
  note               TEXT,
  reviewer_id        TEXT,
  reviewer_name      TEXT,
  timestamp          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id                 TEXT PRIMARY KEY,
  dataset_id         TEXT NOT NULL REFERENCES datasets(id),
  dataset_version_id TEXT REFERENCES dataset_versions(id),
  entity_type        TEXT NOT NULL,
  entity_id          TEXT NOT NULL,
  action             TEXT NOT NULL,
  actor_type         TEXT NOT NULL,
  actor_id           TEXT,
  actor_name         TEXT,
  timestamp          TEXT NOT NULL,
  metadata_json      TEXT,
  correlation_id     TEXT
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id                 TEXT PRIMARY KEY,
  dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id),
  export_type        TEXT NOT NULL,
  format             TEXT NOT NULL,
  filters_json       TEXT,
  status             TEXT NOT NULL,
  created_by         TEXT,
  created_at         TEXT NOT NULL,
  completed_at       TEXT
);

CREATE TABLE IF NOT EXISTS export_artifacts (
  id            TEXT PRIMARY KEY,
  export_job_id TEXT NOT NULL REFERENCES export_jobs(id),
  file_name     TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  format        TEXT NOT NULL,
  size          INTEGER,
  checksum      TEXT
);

-- Recommended indexes (v2.md §14.4).
CREATE INDEX IF NOT EXISTS idx_dataset_versions_dataset_version
  ON dataset_versions (dataset_id, version_number);
CREATE INDEX IF NOT EXISTS idx_images_version
  ON images (dataset_version_id);
CREATE INDEX IF NOT EXISTS idx_annotations_version_image
  ON annotations (dataset_version_id, image_id);
CREATE INDEX IF NOT EXISTS idx_annotations_version_category
  ON annotations (dataset_version_id, category_id);
CREATE INDEX IF NOT EXISTS idx_qa_runs_version
  ON qa_runs (dataset_version_id);
CREATE INDEX IF NOT EXISTS idx_qa_issues_version_severity
  ON qa_issues (dataset_version_id, severity);
CREATE INDEX IF NOT EXISTS idx_qa_issues_version_type
  ON qa_issues (dataset_version_id, type);
CREATE INDEX IF NOT EXISTS idx_qa_issues_version_annotation
  ON qa_issues (dataset_version_id, annotation_id);
CREATE INDEX IF NOT EXISTS idx_review_items_version_status
  ON review_items (dataset_version_id, status);
CREATE INDEX IF NOT EXISTS idx_review_items_version_decision
  ON review_items (dataset_version_id, decision);
CREATE INDEX IF NOT EXISTS idx_review_items_version_target
  ON review_items (dataset_version_id, target_type);
CREATE INDEX IF NOT EXISTS idx_review_history_item_round
  ON review_history (review_item_id, review_round);
CREATE INDEX IF NOT EXISTS idx_audit_events_version_timestamp
  ON audit_events (dataset_version_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_export_jobs_version_created
  ON export_jobs (dataset_version_id, created_at);
