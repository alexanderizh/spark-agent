-- Migration 008: Skill Store — registries table + skills table extensions
-- 参考: docs/prd/PRD-Skill-Store.md §3.3

-- ─── Skill 市场源配置表 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_registries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_url TEXT,
  api_base_url TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  type TEXT NOT NULL DEFAULT 'remote',
  local_path TEXT,
  last_sync_at TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Skills 表扩展字段 ──────────────────────────────────────────────
ALTER TABLE skills ADD COLUMN registry_id TEXT;
ALTER TABLE skills ADD COLUMN remote_id TEXT;
ALTER TABLE skills ADD COLUMN author TEXT NOT NULL DEFAULT '';
ALTER TABLE skills ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE skills ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE skills ADD COLUMN rating REAL NOT NULL DEFAULT 0;
ALTER TABLE skills ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skills ADD COLUMN homepage_url TEXT;
ALTER TABLE skills ADD COLUMN icon_url TEXT;

-- 索引：按市场源查询已安装的 Skill
CREATE INDEX IF NOT EXISTS idx_skills_registry
  ON skills(registry_id);

-- 索引：按分类筛选
CREATE INDEX IF NOT EXISTS idx_skills_category
  ON skills(category);
