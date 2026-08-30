-- 042: Memory V2 — bi-temporal 列 + FTS5 全文索引表
--
-- 1) memory_entry 增加时间感知三列（Graphiti 轻量版 bi-temporal）：
--    valid_from    事实生效时间（存量行回填为 created_at；新行由 repository 写入）
--    invalid_at    事实失效时间（NULL = 仍有效）
--    superseded_by 被哪条记忆取代（memory_entry.id）
--
-- 2) memory_fts：contentless FTS5（content=''）+ contentless_delete=1（SQLite >= 3.43，
--    better-sqlite3 11.x 内置 3.49）。rowid 与 memory_entry 的隐式 rowid 对齐。
--    写入内容必须先过 segmentCjk()（CJK 逐字预分词，见 @spark/storage segment-cjk），
--    tokenizer 保持 unicode61；查询侧用 buildFtsMatchQuery() 包成短语。
--
--    存量条目的 FTS 回填不能在纯 SQL 里做（需要 JS 侧 segmentCjk 分词），
--    由 MemorySearchRepository.backfillFtsIfNeeded() 在代码侧完成，
--    以 app_settings(memory / ftsBackfillDone) 标记幂等。

ALTER TABLE memory_entry ADD COLUMN valid_from INTEGER;
ALTER TABLE memory_entry ADD COLUMN invalid_at INTEGER;
ALTER TABLE memory_entry ADD COLUMN superseded_by TEXT;

-- 存量行回填：valid_from 默认等于 created_at
UPDATE memory_entry SET valid_from = created_at WHERE valid_from IS NULL;

-- 检索默认只召回仍有效条目，加索引
CREATE INDEX IF NOT EXISTS idx_mem_invalid_at ON memory_entry(invalid_at);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  name,
  description,
  body,
  content='',
  contentless_delete=1,
  tokenize='unicode61'
);
