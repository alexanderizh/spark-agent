-- Native Tool Studio: add code tools, separate editable drafts from the stable
-- runtime version, and enrich the privacy-preserving invocation ledger.
-- SQLite cannot alter the type CHECK constraint, so rebuild before creating
-- the version table. At this point no table has a foreign key to custom_tools.

CREATE TABLE custom_tools_native (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http', 'sql', 'command', 'prompt', 'composite', 'code', 'provider-vision')),
  input_schema_json TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('read', 'low-write', 'high-write', 'destructive')),
  effect TEXT NOT NULL CHECK (effect IN ('read', 'create', 'update', 'delete', 'send', 'publish')),
  idempotency TEXT NOT NULL CHECK (idempotency IN ('safe', 'keyed', 'unsafe')),
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  origin TEXT NOT NULL DEFAULT 'local' CHECK (origin IN ('local', 'imported')),
  published_version INTEGER,
  draft_version INTEGER NOT NULL DEFAULT 1,
  last_test_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Existing 0.11.27 tools are already live records; treat their current body
-- as version 1. Snapshot rows are populated lazily by CustomToolRepository so
-- JSON serialization stays identical to the TypeScript protocol.
INSERT INTO custom_tools_native (
  id, title, description, type, input_schema_json, spec_json,
  risk, effect, idempotency, timeout_ms, enabled, origin,
  published_version, draft_version, last_test_at, created_at, updated_at
)
SELECT
  id, title, description, type, input_schema_json, spec_json,
  risk, effect, idempotency, timeout_ms, enabled, origin,
  1, 1, last_test_at, created_at, updated_at
FROM custom_tools;

DROP TABLE custom_tools;
ALTER TABLE custom_tools_native RENAME TO custom_tools;
CREATE INDEX idx_custom_tools_updated ON custom_tools(updated_at DESC);

CREATE TABLE custom_tool_versions (
  tool_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  snapshot_json TEXT NOT NULL,
  source_version INTEGER,
  created_at TEXT NOT NULL,
  published_at TEXT,
  PRIMARY KEY (tool_id, version),
  FOREIGN KEY (tool_id) REFERENCES custom_tools(id) ON DELETE CASCADE
);

CREATE INDEX idx_custom_tool_versions_status
  ON custom_tool_versions(tool_id, status, version DESC);

ALTER TABLE custom_tool_invocations ADD COLUMN tool_version INTEGER;
ALTER TABLE custom_tool_invocations ADD COLUMN source TEXT NOT NULL DEFAULT 'model'
  CHECK (source IN ('direct', 'model', 'host'));

CREATE INDEX idx_custom_tool_invocations_created
  ON custom_tool_invocations(created_at DESC, id DESC);

CREATE TABLE custom_tool_trace_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 365),
  updated_at TEXT NOT NULL
);

INSERT INTO custom_tool_trace_settings (id, retention_days, updated_at)
VALUES (1, 30, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
