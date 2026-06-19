-- 033_media_model_manifests.sql
-- 多媒体模型能力清单与 Provider 启用关系。
--
-- 注意：本文件原编号为 028，与 028_builtin_fullstack_coding_agent.sql 撞号，
-- 导致 migration runner 按 version=28 去重时只会执行其中一个、另一个被静默跳过。
-- 已重编号为 033 修复该问题。表/索引均为 IF NOT EXISTS，重复执行安全。
--
-- media_model_manifests 记录模型能力、参数 schema、调用模板和产物提取方式；
-- media_provider_models 记录某个 ProviderProfile 启用了哪些 manifest 以及本地默认参数覆盖。

CREATE TABLE IF NOT EXISTS media_model_manifests (
  id TEXT PRIMARY KEY,
  provider_kind TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  version TEXT,
  manifest_json TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_media_model_manifests_provider
  ON media_model_manifests (provider_kind, enabled);

CREATE INDEX IF NOT EXISTS idx_media_model_manifests_model
  ON media_model_manifests (model_id);

CREATE TABLE IF NOT EXISTS media_provider_models (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT NOT NULL,
  manifest_id TEXT NOT NULL,
  model_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  defaults_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider_profile_id, manifest_id),
  FOREIGN KEY (provider_profile_id) REFERENCES provider_profiles (id) ON DELETE CASCADE,
  FOREIGN KEY (manifest_id) REFERENCES media_model_manifests (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_provider_models_provider
  ON media_provider_models (provider_profile_id, enabled);

