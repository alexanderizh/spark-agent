-- Cross-session collaboration: materialized forks and read-only references.
-- Parent/source session IDs intentionally do not use foreign keys so deleting a
-- source session preserves the child lineage and turns references unavailable.

CREATE TABLE IF NOT EXISTS session_lineage (
  child_session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  parent_session_id TEXT NOT NULL,
  fork_anchor_turn_id TEXT,
  fork_cutoff_seq INTEGER NOT NULL CHECK (fork_cutoff_seq >= 0),
  source_title_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_lineage_parent
  ON session_lineage(parent_session_id, created_at);

CREATE TABLE IF NOT EXISTS session_references (
  id TEXT PRIMARY KEY,
  target_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_session_id TEXT NOT NULL,
  snapshot_seq INTEGER NOT NULL CHECK (snapshot_seq >= 0),
  source_title_snapshot TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'unavailable')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_references_target_status
  ON session_references(target_session_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_references_source_status
  ON session_references(source_session_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS session_reference_audit (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL REFERENCES session_references(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('attach', 'update_snapshot', 'revoke', 'read')),
  actor TEXT NOT NULL CHECK (actor IN ('user', 'agent', 'system')),
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_reference_audit_reference_created
  ON session_reference_audit(reference_id, created_at DESC);
