-- Track runtime contributions alongside Skills, MCP servers and declarative
-- connector metadata. This is a table rebuild because SQLite CHECK constraints
-- cannot be altered in place.

DROP INDEX IF EXISTS idx_plugin_resources_plugin;
ALTER TABLE plugin_resources RENAME TO plugin_resources_legacy;

CREATE TABLE plugin_resources (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('skill', 'mcp-server', 'connector', 'runtime')),
  resource_id TEXT NOT NULL,
  source_path TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (plugin_id, resource_type, resource_id)
);

INSERT INTO plugin_resources (
  id, plugin_id, resource_type, resource_id, source_path, enabled, metadata_json
)
SELECT id, plugin_id, resource_type, resource_id, source_path, enabled, metadata_json
FROM plugin_resources_legacy;

DROP TABLE plugin_resources_legacy;

CREATE INDEX idx_plugin_resources_plugin ON plugin_resources(plugin_id);
