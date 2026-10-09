-- 118: wiki_page 支持文件夹节点（空间 → 文件夹 → 页面，层级不限）。
--
-- 背景：wiki_page 已有 parent_id（页面可嵌套成树），但 kind CHECK 枚举里没有
-- 独立的「文件夹」容器类型。文件夹是无正文、不进 FTS、不同步双链的纯结构节点，
-- 用 kind='folder' 表达（而非另建一张表），目录树 / 拖拽移动 / 归档等既有机制
-- 全部直接复用。
--
-- SQLite 无法 ALTER CHECK 约束，按标准流程重建表：
--   建新表（放宽 CHECK）→ 拷贝存量行 → DROP 旧表 → RENAME → 重建索引。
-- 存量数据零回填：既有行的 kind 都在原枚举内，原样拷贝即可。
--
-- 注意：114 追加的 pinned 列与 idx_wiki_page_pinned 必须在新表里保留，
-- 否则重建后置顶功能静默丢失。

CREATE TABLE wiki_page_new (
  id            TEXT PRIMARY KEY,             -- wp_<8hex>
  space_id      TEXT NOT NULL,
  parent_id     TEXT,                         -- 目录树父节点，NULL 为根；可为 folder 或页面
  kind          TEXT NOT NULL CHECK(kind IN ('knowledge','experience','pattern','reference','note','folder')),
  title         TEXT NOT NULL,
  slug          TEXT NOT NULL,                -- 空间内唯一，[[双链]] 解析键（folder 同样占位）
  summary       TEXT NOT NULL DEFAULT '',
  file_path     TEXT NOT NULL,                -- 正文 markdown 绝对路径；folder 为 ''（无正文）
  tags_json     TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  confidence    REAL NOT NULL DEFAULT 1.0,
  version       INTEGER NOT NULL DEFAULT 1,   -- CAS 乐观锁
  content_hash  TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  source_type   TEXT,
  source_session_id TEXT,
  author_role   TEXT,
  hit_count     INTEGER NOT NULL DEFAULT 0,
  last_hit_at   INTEGER,
  valid_from    INTEGER,
  invalid_at    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  pinned        INTEGER NOT NULL DEFAULT 0
);

INSERT INTO wiki_page_new
  (id, space_id, parent_id, kind, title, slug, summary, file_path, tags_json,
   status, confidence, version, content_hash, sort_order, source_type,
   source_session_id, author_role, hit_count, last_hit_at, valid_from, invalid_at,
   created_at, updated_at, pinned)
SELECT
  id, space_id, parent_id, kind, title, slug, summary, file_path, tags_json,
  status, confidence, version, content_hash, sort_order, source_type,
  source_session_id, author_role, hit_count, last_hit_at, valid_from, invalid_at,
  created_at, updated_at, pinned
FROM wiki_page;

DROP TABLE wiki_page;
ALTER TABLE wiki_page_new RENAME TO wiki_page;

-- 索引按 112 原样重建（slug 唯一性不受 folder 影响：文件夹同样占 slug 槽位）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wiki_page_slug
  ON wiki_page(space_id, slug) WHERE status != 'archived';
CREATE INDEX IF NOT EXISTS idx_wiki_page_space ON wiki_page(space_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_wiki_page_parent ON wiki_page(parent_id);
CREATE INDEX IF NOT EXISTS idx_wiki_page_kind ON wiki_page(space_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_wiki_page_pinned ON wiki_page(space_id, pinned, sort_order);
