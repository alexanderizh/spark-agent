-- 027_canvas_snapshots.sql
-- 无限画布项目与快照持久化（生产级 SQLite 存储，替代纯 localStorage demo）。
--
-- 设计：
--   canvas_projects      — 画布项目元数据（标题/描述/计数/时间戳），支持列表与排序
--   canvas_snapshots     — 每个项目一行完整快照（nodes/edges/assets/tasks/board 的 JSON）
--
-- 渲染端继续用 localStorage 做即时读写（响应快），关键变更后异步双写到本表，
-- 保证数据落 SQLite（可备份 / 跨窗口一致 / 跨设备迁移）。详见
-- docs/multimedia-model-providers.md §4。

CREATE TABLE IF NOT EXISTS canvas_projects (
  id              TEXT    PRIMARY KEY,
  user_id         INTEGER NOT NULL DEFAULT 0,
  title           TEXT    NOT NULL DEFAULT '',
  description     TEXT,
  status          TEXT    NOT NULL DEFAULT 'active',
  cover_asset_id  TEXT,
  node_count      INTEGER NOT NULL DEFAULT 0,
  asset_count     INTEGER NOT NULL DEFAULT 0,
  task_count      INTEGER NOT NULL DEFAULT 0,
  last_opened_at  TEXT,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canvas_projects_user_status
  ON canvas_projects (user_id, status);

CREATE INDEX IF NOT EXISTS idx_canvas_projects_last_opened
  ON canvas_projects (last_opened_at);

CREATE TABLE IF NOT EXISTS canvas_snapshots (
  project_id      TEXT    PRIMARY KEY,
  user_id         INTEGER NOT NULL DEFAULT 0,
  snapshot_json   TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  FOREIGN KEY (project_id) REFERENCES canvas_projects (id) ON DELETE CASCADE
);
