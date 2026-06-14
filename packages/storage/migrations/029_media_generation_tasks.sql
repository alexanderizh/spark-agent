-- 029_media_generation_tasks.sql
-- 多媒体生成任务生命周期表。
--
-- 该表记录 agent / 无限画布发起的图片、音频、视频生成任务，作为
-- submit / inquire / cancel / materialize 的持久化基础。首版 runtime 仍可同步等待
-- adapter 完成，但所有状态、request id、产物和错误都会落在这里，便于后续升级为后台轮询。

CREATE TABLE IF NOT EXISTS media_generation_tasks (
  id TEXT PRIMARY KEY,
  provider_profile_id TEXT,
  provider_kind TEXT,
  manifest_id TEXT,
  model_id TEXT,
  operation TEXT NOT NULL,
  capability TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  mode TEXT,
  prompt TEXT,
  negative_prompt TEXT,
  input_files_json TEXT NOT NULL DEFAULT '[]',
  model_params_json TEXT NOT NULL DEFAULT '{}',
  output_dir TEXT NOT NULL,
  request_id TEXT,
  assets_json TEXT NOT NULL DEFAULT '[]',
  raw_response_json TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_generation_tasks_status
  ON media_generation_tasks (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_media_generation_tasks_provider
  ON media_generation_tasks (provider_profile_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_media_generation_tasks_request
  ON media_generation_tasks (request_id);
