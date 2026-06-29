-- Migration 039: Connector connections
-- 持久化第三方连接器（当前首个落地为 GitHub）配置与非敏感账号摘要。
-- 明文 secret 绝不入库，只保存 keystore_ref。

CREATE TABLE IF NOT EXISTS connector_connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  status TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  keystore_ref TEXT,
  granted_scopes_json TEXT NOT NULL DEFAULT '[]',
  account_json TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_connections_provider
  ON connector_connections(provider);
