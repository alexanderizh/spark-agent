-- SparkWork 子应用开发平台 V2：多文件应用包、连接绑定、服务状态与持久任务。
-- V1 列与表保持不变；新列均有兼容缺省值。

ALTER TABLE sub_apps ADD COLUMN draft_format TEXT NOT NULL DEFAULT 'v1'
  CHECK (draft_format IN ('v1', 'v2'));
ALTER TABLE sub_apps ADD COLUMN draft_project_revision INTEGER;
ALTER TABLE sub_apps ADD COLUMN draft_package_manifest_json TEXT;

CREATE TABLE sub_app_artifacts (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL,
  relative_path TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  file_count INTEGER NOT NULL CHECK (file_count >= 0),
  manifest_json TEXT NOT NULL,
  build_info_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE sub_app_release_artifacts (
  release_id TEXT PRIMARY KEY REFERENCES sub_app_releases(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES sub_app_artifacts(id) ON DELETE RESTRICT,
  frontend_entry TEXT NOT NULL,
  service_entry TEXT,
  contract_digest TEXT,
  permission_digest TEXT NOT NULL
);
CREATE INDEX idx_sub_app_release_artifacts_artifact
  ON sub_app_release_artifacts(artifact_id);

CREATE TABLE sub_app_connection_bindings (
  app_id TEXT NOT NULL REFERENCES sub_apps(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  binding_kind TEXT NOT NULL CHECK (binding_kind IN ('api-connection', 'provider-profile')),
  binding_id TEXT NOT NULL,
  granted_origins_json TEXT NOT NULL DEFAULT '[]',
  allow_private_network INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, slot)
);

CREATE TABLE sub_app_service_state (
  app_id TEXT PRIMARY KEY REFERENCES sub_apps(id) ON DELETE CASCADE,
  release_id TEXT REFERENCES sub_app_releases(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'stopped'
    CHECK (status IN ('stopped', 'starting', 'running', 'degraded', 'crashed')),
  restart_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  last_exit_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE sub_app_jobs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES sub_apps(id) ON DELETE CASCADE,
  release_id TEXT NOT NULL REFERENCES sub_app_releases(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
  input_json TEXT NOT NULL DEFAULT 'null',
  progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  message TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT 'null',
  result_json TEXT NOT NULL DEFAULT 'null',
  error_json TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sub_app_jobs_app_status_created
  ON sub_app_jobs(app_id, status, created_at DESC);
