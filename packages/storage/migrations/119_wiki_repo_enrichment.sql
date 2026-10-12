-- 119_wiki_repo_enrichment.sql
-- Repo Wiki AI 导读缓存（方案B，todo/2026-10-12 设计方案 §5.2）。
--
-- 为什么独立表：wiki_page 的 content_hash 是骨架幂等 CAS 的锚点（同 rev 两次
-- rebuild 逐字节一致），AI 段写入正文会让哈希永远失配、版本号无限推进。
-- 导读是「按 rev 缓存的派生数据」，既不是页面内容也不是用户偏好，参照
-- wiki_extraction_state（migration 113）的先例单独建表。
-- 键用 slug 而非 page_id：slug 是 Repo Wiki 的重建稳定身份键（rebuild 按
-- slug 定位更新）；页面被删重建后 id 变化而 slug 不变，缓存仍然命中。
CREATE TABLE IF NOT EXISTS wiki_repo_enrichment (
  space_id   TEXT NOT NULL,
  slug       TEXT NOT NULL,
  repo_rev   TEXT NOT NULL,
  section    TEXT NOT NULL,                    -- AI 导读 markdown 段
  status     TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','failed')),
  error      TEXT,                             -- 仅失败原因分类，不含正文/上下文片段
  model      TEXT,
  provider   TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, slug, repo_rev)
);

CREATE INDEX IF NOT EXISTS idx_wiki_repo_enrich_space
  ON wiki_repo_enrichment(space_id, updated_at);
