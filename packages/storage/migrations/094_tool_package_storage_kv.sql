-- Package-isolated durable KV storage for Tool Package host capabilities.

CREATE TABLE tool_package_storage_kv (
  package_id TEXT NOT NULL REFERENCES tool_packages(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (package_id, key)
);

CREATE INDEX idx_tool_package_storage_updated
  ON tool_package_storage_kv(package_id, updated_at DESC);
