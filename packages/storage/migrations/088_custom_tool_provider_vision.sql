-- Provider-backed image understanding custom tool.
-- SQLite cannot alter a CHECK constraint in place, so rebuild custom_tools
-- while preserving every existing row and timestamp.

CREATE TABLE custom_tools_next (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  -- Keep the legacy composite value migratable even though the current editor
  -- does not create or execute it.
  type TEXT NOT NULL CHECK (type IN ('http', 'sql', 'command', 'prompt', 'composite', 'provider-vision')),
  input_schema_json TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('read', 'low-write', 'high-write', 'destructive')),
  effect TEXT NOT NULL CHECK (effect IN ('read', 'create', 'update', 'delete', 'send', 'publish')),
  idempotency TEXT NOT NULL CHECK (idempotency IN ('safe', 'keyed', 'unsafe')),
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  origin TEXT NOT NULL DEFAULT 'local' CHECK (origin IN ('local', 'imported')),
  last_test_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO custom_tools_next (
  id, title, description, type, input_schema_json, spec_json,
  risk, effect, idempotency, timeout_ms, enabled, origin,
  last_test_at, created_at, updated_at
)
SELECT
  id, title, description, type, input_schema_json, spec_json,
  risk, effect, idempotency, timeout_ms, enabled, origin,
  last_test_at, created_at, updated_at
FROM custom_tools;

DROP TABLE custom_tools;
ALTER TABLE custom_tools_next RENAME TO custom_tools;
CREATE INDEX idx_custom_tools_updated ON custom_tools(updated_at DESC);
