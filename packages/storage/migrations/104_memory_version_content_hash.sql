-- Migration 104: memory_entry 版本与内容哈希（S1B.1）
--
-- 长期记忆生命周期加固（docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S1B 切片 1）：
--   - version：单调递增版本号，CAS 式条件提交的依据
--     （UPDATE ... WHERE id=? AND version=expected，影响 0 行即失配丢弃/重排队，
--      SQLite 单写者事务保证检查与写入原子）。存量行回填 1；此后每次有效写入 +1。
--   - content_hash：当前权威正文的 SHA-256（hex）。用途：
--     ① 托管正文守卫（方案 B，不迁目录）：旧 CLI 覆盖文件后哈希失配，
--        读取方拒绝采信并报不完整，不自动用任意同名 Markdown 补回；
--     ② 快照枚举与迁移清单校验（S1B.4 删除协调）。
-- 迁移只加列并回填确定性默认值，不在 SQL 侧读文件回填真实哈希；
-- content_hash 为 NULL 表示"尚未建立守卫"，首次经过写入路径时补齐。

ALTER TABLE memory_entry ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE memory_entry ADD COLUMN content_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_memory_entry_version ON memory_entry (id, version);
