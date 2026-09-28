-- Migration 107: memory_entry 来源绑定（S2.1）
--
-- 长期记忆生命周期加固（docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S2 切片 1）：
-- 新记忆保存真实 source event 引用 / 作者角色 / 提取类别 / 证据状态，不依赖 LLM 自报角色。
--   - source_event_id：真实事件引用（agent_events.id，承载本轮用户消息的事件）。
--     由系统侧（session.service）从事件流取得，不进抽取 prompt、不由 LLM 产出 ——
--     LLM candidate 中不存在任何来源注入点。
--   - source_turn_id：本轮 turn_id（agent_events.turn_id）。同 turn 重试可据此识别（N2 幂等基础）。
--   - author_role：内容作者的真实装配角色，枚举
--     'host_agent'（主会话助手）| 'team_member'（团队成员）| 'consolidation'（整合）
--     | 'manual_user'（用户手工）| 'sync_import'（同步导入）。
--   - author_agent_id：真实装配身份 id（host agentId / member.id），与 LLM 自报无关。
--   - extraction_kind：产生路径，枚举 'turn_extraction' | 'consolidation' | 'manual' | 'sync_import'。
--   - extraction_model：实际调用的提取模型 id（settings / fallback 真实值）。
--   - evidence_status：证据状态 'available' | 'unavailable'。
--     来源会话删除后置 'unavailable' 并保留 source_session_id 引用（不伪造"无来源"）。
--
-- 存量行：全部列可空 / 默认 'available' —— 旧数据无来源标注是"已知部分不补造"，
-- evidence_status 默认 available 仅表示"无已知证据缺失"，来源字段 NULL 即如实标注未知来源。

ALTER TABLE memory_entry ADD COLUMN source_event_id TEXT;
ALTER TABLE memory_entry ADD COLUMN source_turn_id TEXT;
ALTER TABLE memory_entry ADD COLUMN author_role TEXT;
ALTER TABLE memory_entry ADD COLUMN author_agent_id TEXT;
ALTER TABLE memory_entry ADD COLUMN extraction_kind TEXT;
ALTER TABLE memory_entry ADD COLUMN extraction_model TEXT;
ALTER TABLE memory_entry ADD COLUMN evidence_status TEXT NOT NULL DEFAULT 'available';

CREATE INDEX IF NOT EXISTS idx_memory_source_event ON memory_entry (source_event_id)
  WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_source_turn ON memory_entry (source_turn_id)
  WHERE source_turn_id IS NOT NULL;
