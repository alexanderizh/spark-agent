-- 低代码自定义工具平台（docs/plans/2026-08-16-custom-tools-platform.md）。
-- spec 为声明式 DSL；密钥只存密钥库引用（secretRefs），明文永不落库。
-- 时间戳沿用全仓 TEXT ISO-8601 惯例（与 sub_apps/mcp_servers 一致）。

CREATE TABLE IF NOT EXISTS custom_tools (
  id TEXT PRIMARY KEY,                      -- 原生 Runtime Catalog slug
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http', 'sql', 'command', 'prompt', 'composite')),
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

CREATE INDEX IF NOT EXISTS idx_custom_tools_updated ON custom_tools(updated_at DESC);

-- 调用审计：不存完整输入/输出（隐私+体积），只存输入哈希与结果口径
CREATE TABLE IF NOT EXISTS custom_tool_invocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id TEXT NOT NULL,
  session_id TEXT,
  turn_id TEXT,
  input_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'timeout', 'denied')),
  duration_ms INTEGER NOT NULL,
  error_code TEXT,
  output_bytes INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cti_tool_created ON custom_tool_invocations(tool_id, created_at);
