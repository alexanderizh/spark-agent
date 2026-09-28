-- Migration 109: memory_candidate 候选确认区（S2.3）
--
-- 长期记忆生命周期加固（docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S2 切片 3）：
-- 模型推断的行为规则晋级（consolidation ELEVATE）不再直接写入稳定 feedback，
-- 先进候选区；晋级须真实用户经可信界面的结构化确认（绑定 candidate id +
-- 内容摘要），后端核验状态、摘要与范围（N12：模型自称确认被结构性拒绝）。
--
-- 设计要点：
--   - status 枚举：'pending'（待确认）| 'confirmed'（已确认并晋级）
--     | 'rejected'（用户拒绝）| 'expired'（过期/容量淘汰）。
--   - content_digest：候选展示内容（name+description+body）的 SHA-256 —— 确认
--     请求必须携带该摘要；候选内容被改写后旧摘要确认失配拒绝（"新内容不能
--     继承旧确认"）。同 scope 同摘要的既往候选（任意状态）不再重复征集
--     （同一建议经多次总结/整合不生成独立证据票数，N1/N2）。
--   - payload_json：LLM 提议的完整内容（type/name/description/body/confidence/
--     entities/sourceIds），确认时按原文落库 —— 展示什么就存什么。
--   - confirmed_digest + entry_id：确认时记录，确认只覆盖指定版本；条目后续
--     更新后摘要与当前内容失配即确认过时（展示层可解释）。
--   - 候选生命周期与条目生命周期分开：候选过期（expires_at）与容量上限由
--     仓库插入时统一清理，不触碰 memory_entry。
--
-- 存量数据：空表起步；既有已由旧 ELEVATE 直接写入的 feedback 不回溯降级
--（保留来源提示 author_role='consolidation'，见 migration 107）。

CREATE TABLE IF NOT EXISTS memory_candidate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  scope_ref TEXT,                 -- NULL = 全局（user scope 等）
  content_digest TEXT NOT NULL,   -- 展示内容摘要（确认绑定）
  payload_json TEXT NOT NULL,     -- 提议全文（确认时原文落库）
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,    -- 过期时刻（pending 超时 → expired）
  decided_at INTEGER,             -- 确认/拒绝时刻
  decided_via TEXT,               -- 决策通道（当前仅 'user_ipc'）
  entry_id TEXT,                  -- 确认晋级创建的条目 id
  confirmed_digest TEXT           -- 确认时绑定的摘要（版本覆盖范围凭证）
);

CREATE INDEX IF NOT EXISTS idx_memcand_pending
  ON memory_candidate (scope, scope_ref, status, created_at);
CREATE INDEX IF NOT EXISTS idx_memcand_digest
  ON memory_candidate (scope, scope_ref, content_digest);
