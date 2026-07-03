-- 045: Memory V2 修复 — uniq_mem_name 部分索引纳入 invalid_at
--
-- 背景：025 建的 uniq_mem_name 仅 `WHERE archived = 0`。V2 演化 DELETE / 整合 MERGE
-- 只置 invalid_at（archived 仍 0），失效条目仍占 (scope, scope_ref, name) 唯一槽位。
-- 后续同事实同名候选（规范化 slug 高度撞名）走 evolution ADD → insert 撞 UNIQUE 抛错，
-- 且因 processCandidate 无 per-candidate 隔离会拖死整轮候选（静默数据丢失）。
--
-- 修复：唯一索引追加 invalid_at IS NULL，失效条目释放名字槽位，同名新条目可重建。
-- 与检索层（searchBm25/searchKnn 已带 invalid_at IS NULL）、recall（失效标注）、
-- 注入（listByScope 默认过滤 invalid_at，见 memory.repository）一致。

DROP INDEX IF EXISTS uniq_mem_name;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mem_name
  ON memory_entry(scope, scope_ref, name) WHERE archived = 0 AND invalid_at IS NULL;
