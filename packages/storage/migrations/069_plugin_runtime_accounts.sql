-- Production plugin runtime storage.
-- Secrets remain in the OS keystore; SQLite stores only credential_ref.

CREATE TABLE IF NOT EXISTS connector_accounts (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  runtime_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  auth_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'needs_auth'
    CHECK (status IN ('not_configured', 'needs_auth', 'connected', 'syncing', 'error', 'disabled')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  granted_scopes_json TEXT NOT NULL DEFAULT '[]',
  enabled_capabilities_json TEXT NOT NULL DEFAULT '[]',
  resource_scope_json TEXT NOT NULL DEFAULT '{}',
  config_json TEXT NOT NULL DEFAULT '{}',
  credential_ref TEXT,
  token_expires_at TEXT,
  last_health_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (plugin_id, runtime_id, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_accounts_runtime
  ON connector_accounts(plugin_id, runtime_id, enabled, status);

CREATE TABLE IF NOT EXISTS connector_account_defaults (
  plugin_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plugin_id, runtime_id)
);

CREATE TABLE IF NOT EXISTS connector_sync_cursors (
  account_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  cursor_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, resource_type)
);

CREATE TABLE IF NOT EXISTS plugin_runtime_audit (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  account_id TEXT,
  tool_name TEXT NOT NULL,
  risk TEXT NOT NULL,
  effect TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'error', 'denied')),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  resource_ids_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plugin_runtime_audit_lookup
  ON plugin_runtime_audit(plugin_id, runtime_id, account_id, created_at DESC);

-- One-time compatibility import from the original GitHub-only connection table.
-- The legacy table is intentionally kept for one release so old IPC callers can
-- continue to read it while new callers use connector_accounts.
INSERT OR IGNORE INTO connector_accounts (
  id, plugin_id, runtime_id, provider, external_account_id, display_name,
  avatar_url, auth_method, status, enabled, granted_scopes_json,
  enabled_capabilities_json, resource_scope_json, config_json, credential_ref,
  last_health_at, last_error, created_at, updated_at
)
SELECT
  'runtime-' || id,
  'spark.' || provider,
  provider,
  provider,
  COALESCE(CAST(json_extract(account_json, '$.id') AS TEXT), id),
  name,
  json_extract(account_json, '$.avatarUrl'),
  auth_method,
  CASE
    WHEN status IN ('not_configured', 'needs_auth', 'connected', 'syncing', 'error', 'disabled')
      THEN status
    ELSE 'needs_auth'
  END,
  enabled,
  granted_scopes_json,
  COALESCE(json_extract(config_json, '$.enabledCapabilities'), '[]'),
  json_object('repos', json_extract(config_json, '$.selectedRepos')),
  config_json,
  keystore_ref,
  last_sync_at,
  last_error,
  created_at,
  updated_at
FROM connector_connections
WHERE EXISTS (SELECT 1 FROM plugins WHERE plugins.id = 'spark.' || connector_connections.provider);
-- The built-in plugin rows are registered immediately after migrations. If a
-- database is upgraded before that step, RuntimeBroker performs the same
-- compatibility import once the plugin row exists.

INSERT OR IGNORE INTO connector_account_defaults (plugin_id, runtime_id, account_id)
SELECT plugin_id, runtime_id, id
FROM connector_accounts;
