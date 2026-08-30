-- Long-lived SparkWork sub-app catalog, immutable releases and app-owned data.
-- Sub-apps intentionally have no session foreign key: sessions are only an
-- operation entry point and deleting a session must not affect an app.

CREATE TABLE IF NOT EXISTS sub_apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT,
  entry TEXT NOT NULL DEFAULT 'index.html',
  surface TEXT NOT NULL CHECK (surface IN ('content', 'panel', 'overlay', 'global-window', 'desktop-pet')),
  publication_status TEXT NOT NULL CHECK (publication_status IN ('draft', 'published', 'archived')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  draft_source TEXT NOT NULL DEFAULT '',
  draft_config_json TEXT NOT NULL DEFAULT '{}',
  draft_permissions_json TEXT NOT NULL DEFAULT '[]',
  draft_revision INTEGER NOT NULL DEFAULT 1 CHECK (draft_revision > 0),
  published_release_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sub_apps_menu
  ON sub_apps(publication_status, enabled, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_apps_name
  ON sub_apps(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS sub_app_releases (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES sub_apps(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  source TEXT NOT NULL,
  config_json TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  entry TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('content', 'panel', 'overlay', 'global-window', 'desktop-pet')),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT,
  published_at TEXT NOT NULL,
  UNIQUE(app_id, version)
);

CREATE INDEX IF NOT EXISTS idx_sub_app_releases_app_version
  ON sub_app_releases(app_id, version DESC);

CREATE TABLE IF NOT EXISTS sub_app_data (
  app_id TEXT NOT NULL REFERENCES sub_apps(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_sub_app_data_namespace_key
  ON sub_app_data(app_id, namespace, key);
