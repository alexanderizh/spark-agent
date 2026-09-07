-- 096: 工作流包(workflow bundle)隔离空间
-- .sparkflow 包导入登记表;包内工作流与 MCP 通过 bundle_id 挂靠,技能走 bundle: 前缀 ID。
CREATE TABLE IF NOT EXISTS workflow_bundles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  author TEXT,
  description TEXT,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  source TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'passed', 'warned', 'failed')),
  created_at TEXT,
  updated_at TEXT
);

ALTER TABLE workflows ADD COLUMN bundle_id TEXT;
ALTER TABLE mcp_servers ADD COLUMN bundle_id TEXT;

CREATE INDEX IF NOT EXISTS idx_workflows_bundle_id ON workflows(bundle_id);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_bundle_id ON mcp_servers(bundle_id);
