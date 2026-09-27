-- Migration 108: memory_revision 版本历史 + memory_derivation 派生边（S2.2）
--
-- 长期记忆生命周期加固（docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S2 切片 2）：
-- 在 S1B 提交版本基础上增加 revision 历史保留与来源/派生关系查询。
--
-- memory_revision：每次提交覆盖前保留旧版本（正文快照存 DB —— 记忆正文是短文本，
-- 历史版本是附属记录而非权威载体，避免文件数量膨胀与孤儿清理复杂度）。
--   - 当前版本仍以 memory_entry 行 + 正文文件为权威（version 计数 + content_hash 守卫）；
--     被替代/作废的版本才进本表（supersede_kind 区分去向）。
--   - supersede_kind 枚举：'update'（常规内容更新）| 'merge'（整合合并）
--     | 'supersede'（显式替代，successor_id 指向替代者）| 'retract'（撤回作废）。
--     显式 delete 是用户物理清除意愿，连本表记录一并清理（不产生 'delete' 快照）。
--   - 旧历史不补造：本表启用（migration 108）前的版本不存在是已知事实，
--     历史查询必须如实说明覆盖范围，不伪造完整版本链。
--
-- memory_derivation：条目间派生关系边（来源 → 派生）。
--   - kind 枚举：'merge'（多条源合并为一条，source=被吸收条目，derived=保留条目）
--     | 'elevate'（多条低阶条目升华出新条目，source=来源条目，derived=新条目）
--     | 'supersede'（显式替代，source=旧条目，derived=替代条目）。
--   - 撤回来源时可沿边找到派生条目标记待复核（H2 纠正影响传播），不删除不级联。
--
-- 存量数据：两表为空起步 —— 无历史可保留是"已知部分不补造"的一部分。

CREATE TABLE IF NOT EXISTS memory_revision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  confidence REAL NOT NULL,
  author_role TEXT,
  source_event_id TEXT,
  valid_from INTEGER NOT NULL,    -- 该版本生效时刻（写入时的 updated_at）
  superseded_at INTEGER NOT NULL, -- 被替代/作废时刻
  supersede_kind TEXT NOT NULL,
  successor_id TEXT,              -- supersede/merge 时的替代条目 id；retract 为 NULL
  note TEXT,                      -- 附注（撤回原因 / 合并说明等，如实可为空）
  UNIQUE (memory_id, version)
);

CREATE INDEX IF NOT EXISTS idx_memrev_memory ON memory_revision (memory_id, version);

CREATE TABLE IF NOT EXISTS memory_derivation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  derived_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (source_id, derived_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_memder_source ON memory_derivation (source_id);
CREATE INDEX IF NOT EXISTS idx_memder_derived ON memory_derivation (derived_id);
