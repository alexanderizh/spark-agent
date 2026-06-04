-- Migration 016: Team Mode (Agent-to-Agent dispatch) runtime metadata
--
-- 团队模式：主 Agent（Host）通过 agent_team_dispatch 工具调用成员 Agent（Member）。
--
-- 会话级团队配置（enabled / hostAgentId / memberAgentIds / maxDepth / allowNesting）
-- 写入既有 sessions.metadata_json 的 team 字段，**不新增列**，避免破坏现有 session.repository。
--
-- 本 migration 只新增 dispatch 记录表，用于回放、统计与权限审计。

CREATE TABLE IF NOT EXISTS team_dispatches (
  id TEXT PRIMARY KEY,                  -- uuid
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  parent_dispatch_id TEXT,              -- 嵌套 dispatch 的父 dispatch（v1 默认 null）
  host_agent_id TEXT NOT NULL,
  member_agent_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','working','completed','failed','canceled')),
  task_json TEXT NOT NULL,              -- TeamA2ATask 的 JSON
  reply_json TEXT,                      -- TeamA2AReply 的 JSON（完成后写入）
  error_message TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  duration_ms INTEGER,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_dispatches_session
  ON team_dispatches(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_team_dispatches_turn
  ON team_dispatches(turn_id);
CREATE INDEX IF NOT EXISTS idx_team_dispatches_member
  ON team_dispatches(member_agent_id);
