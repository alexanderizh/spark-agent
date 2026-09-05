-- Unified, privacy-preserving invocation traces across every tool source.
-- Input/output bodies and secrets are intentionally not persisted.

CREATE TABLE tool_invocations (
  id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'connector', 'custom-tool', 'tool-package', 'workflow', 'test'
  )),
  source_id TEXT NOT NULL,
  package_id TEXT,
  tool_id TEXT,
  tool_name TEXT NOT NULL,
  version TEXT,
  adapter TEXT,
  session_id TEXT,
  turn_id TEXT,
  project_id TEXT,
  agent_id TEXT,
  workflow_id TEXT,
  invocation_source TEXT NOT NULL CHECK (invocation_source IN (
    'model', 'workflow', 'test', 'platform', 'nested'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'running', 'ok', 'error', 'timeout', 'denied', 'cancelled'
  )),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  error_code TEXT,
  input_sha256 TEXT NOT NULL,
  output_bytes INTEGER,
  result_archived INTEGER NOT NULL DEFAULT 0 CHECK (result_archived IN (0, 1)),
  result_truncated INTEGER NOT NULL DEFAULT 0 CHECK (result_truncated IN (0, 1)),
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_tool_invocations_created ON tool_invocations(created_at DESC);
CREATE INDEX idx_tool_invocations_source ON tool_invocations(source_kind, source_id, created_at DESC);
CREATE INDEX idx_tool_invocations_session ON tool_invocations(session_id, created_at DESC);
CREATE INDEX idx_tool_invocations_correlation ON tool_invocations(correlation_id);
CREATE INDEX idx_tool_invocations_status ON tool_invocations(status, created_at DESC);
