-- Generic Tool Package platform. These tables are independent from the legacy
-- custom_tools tables so old installations keep working during migration.

CREATE TABLE tool_packages (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN (
    'managed-project', 'local-directory', 'local-archive', 'registry', 'remote', 'mcp-import'
  )),
  trust TEXT NOT NULL CHECK (trust IN ('trusted-local', 'verified', 'blocked')),
  state TEXT NOT NULL CHECK (state IN (
    'inspected', 'installed-disabled', 'configuration-ready', 'enabled', 'error'
  )),
  enabled_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tool_package_versions (
  package_id TEXT NOT NULL REFERENCES tool_packages(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  install_path TEXT NOT NULL,
  source_path TEXT,
  integrity_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staged', 'installed', 'failed', 'archived')),
  installed_at TEXT NOT NULL,
  PRIMARY KEY (package_id, version)
);

CREATE TABLE tool_package_tools (
  package_id TEXT NOT NULL,
  version TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  definition_json TEXT NOT NULL,
  PRIMARY KEY (package_id, version, tool_name),
  FOREIGN KEY (package_id, version)
    REFERENCES tool_package_versions(package_id, version) ON DELETE CASCADE
);

CREATE TABLE tool_package_config (
  package_id TEXT NOT NULL REFERENCES tool_packages(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN (
    'package', 'tool', 'project', 'agent', 'workflow', 'session'
  )),
  scope_id TEXT NOT NULL DEFAULT '',
  tool_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0 CHECK (is_secret IN (0, 1)),
  value_json TEXT,
  keystore_ref TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (package_id, scope, scope_id, tool_name, name),
  CHECK (
    (is_secret = 0 AND value_json IS NOT NULL AND keystore_ref IS NULL) OR
    (is_secret = 1 AND value_json IS NULL AND keystore_ref IS NOT NULL)
  )
);

CREATE TABLE tool_package_permissions (
  package_id TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('os-effect', 'spark-capability')),
  permission TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  state TEXT NOT NULL CHECK (state IN ('pending', 'granted', 'denied')),
  reviewed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (package_id, version, kind, permission),
  FOREIGN KEY (package_id, version)
    REFERENCES tool_package_versions(package_id, version) ON DELETE CASCADE
);

CREATE INDEX idx_tool_packages_state ON tool_packages(state, updated_at DESC);
CREATE INDEX idx_tool_package_versions_package
  ON tool_package_versions(package_id, installed_at DESC);
CREATE INDEX idx_tool_package_config_package ON tool_package_config(package_id, scope, scope_id);
CREATE INDEX idx_tool_package_permissions_state
  ON tool_package_permissions(package_id, version, state);
