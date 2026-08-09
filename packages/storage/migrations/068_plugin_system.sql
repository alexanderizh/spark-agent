-- Plugin platform: installed packages, marketplace sources, permissions and resources.
-- Plugins are declarative; resource rows allow activation to be reversed without
-- guessing which Skill/MCP records were created by a plugin.

CREATE TABLE IF NOT EXISTS plugin_registries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  api_base_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  trusted_key_fingerprints_json TEXT NOT NULL DEFAULT '[]',
  config_json TEXT NOT NULL DEFAULT '{}',
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  author_name TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  install_path TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('bundled', 'local', 'marketplace')),
  enabled INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'installed' CHECK (state IN ('installed', 'blocked', 'error')),
  trust TEXT NOT NULL DEFAULT 'unverified' CHECK (trust IN ('bundled', 'verified', 'unverified', 'blocked')),
  integrity_sha256 TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_permissions (
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('granted', 'denied', 'pending')),
  granted_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, permission)
);

CREATE TABLE IF NOT EXISTS plugin_resources (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('skill', 'mcp-server', 'connector')),
  resource_id TEXT NOT NULL,
  source_path TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (plugin_id, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_plugins_enabled ON plugins(enabled);
CREATE INDEX IF NOT EXISTS idx_plugin_resources_plugin ON plugin_resources(plugin_id);

INSERT OR IGNORE INTO plugin_registries
  (id, name, description, api_base_url, enabled, trusted_key_fingerprints_json, config_json)
VALUES
  ('spark-official', 'Spark 官方插件市场', 'Spark 插件包与签名目录。可在设置中修改为企业内网市场。', 'https://plugins.spark-agent.com/v1', 1, '[]', '{}');
