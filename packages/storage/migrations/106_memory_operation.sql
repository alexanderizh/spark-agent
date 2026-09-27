-- Migration 106: 记忆删除协调操作表（S1B.4 删除协调）
--
-- 长期记忆生命周期加固（docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S1B 切片 4）：
-- 删除/归档是跨存储介质的协调操作（DB+FTS+vec / 磁盘 markdown / MEMORY.md 投影 /
-- 后续受控导出与同步），任一步骤失败或进程中断都会留下不一致残留。
-- memory_operation 持久记录操作意图与待清理位置，保证：
--   1. 清理完成前不丢失目标路径与删除意图（重启可从记录继续）；
--   2. 状态机可观测：pending → barrier_set（DB 屏障已设）→ cleaning（文件/
--      投影清理中）→ local_purge_complete（本地清理完成）/ sync_pending
--      （本地完成、远端待同步，S1B.5 使用）/ failed（残留未清，保持待清理，
--      可重试）；
--   3. 重启扫描 status NOT IN 终态（local_purge_complete/sync_pending/failed）
--      的记录逐个重试，清理幂等（文件不存在视为已清）。
--
-- targets_json：{ filePath, scope, scopeRef, memoryIndexPath? } —— 待清理
-- 位置的完整清单，清理失败时凭此重试，不需要目标行仍存在。

CREATE TABLE IF NOT EXISTS memory_operation (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('delete', 'archive', 'purge_orphan')),
  target_id TEXT NOT NULL,
  target_version INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'barrier_set', 'cleaning', 'local_purge_complete', 'sync_pending', 'failed')),
  targets_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_memory_operation_status ON memory_operation (status);
CREATE INDEX IF NOT EXISTS idx_memory_operation_target ON memory_operation (target_id);
