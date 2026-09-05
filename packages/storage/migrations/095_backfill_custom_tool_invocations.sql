-- Preserve legacy Custom Tool history in the unified query surface.
-- Deterministic ids make the backfill idempotent if a repaired database replays it.

INSERT OR IGNORE INTO tool_invocations (
  id,
  correlation_id,
  source_kind,
  source_id,
  tool_id,
  tool_name,
  version,
  adapter,
  session_id,
  turn_id,
  invocation_source,
  status,
  started_at,
  finished_at,
  duration_ms,
  error_code,
  input_sha256,
  output_bytes,
  created_at
)
SELECT
  'legacy-custom-tool-' || CAST(invocation.id AS TEXT),
  'legacy-custom-tool-' || CAST(invocation.id AS TEXT),
  'custom-tool',
  invocation.tool_id,
  invocation.tool_id,
  invocation.tool_id,
  CASE
    WHEN invocation.tool_version IS NULL THEN NULL
    ELSE CAST(invocation.tool_version AS TEXT)
  END,
  tool.type,
  invocation.session_id,
  invocation.turn_id,
  CASE invocation.source
    WHEN 'model' THEN 'model'
    ELSE 'platform'
  END,
  invocation.status,
  invocation.created_at,
  invocation.created_at,
  invocation.duration_ms,
  invocation.error_code,
  invocation.input_sha256,
  invocation.output_bytes,
  invocation.created_at
FROM custom_tool_invocations AS invocation
JOIN custom_tools AS tool ON tool.id = invocation.tool_id;
