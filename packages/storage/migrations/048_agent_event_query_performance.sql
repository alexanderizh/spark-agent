-- Migration 048: Agent event query performance
--
-- 会话切换/删除的热路径会按 session + seq/turn/mode 查询 agent_events。
-- seq/mode 原先藏在 event_json 中，每次查询都要 json_extract + 临时排序。
-- 使用 VIRTUAL generated columns 保持写入兼容，同时让 SQLite 可以建立表达式等价索引。

ALTER TABLE agent_events
  ADD COLUMN seq INTEGER
  GENERATED ALWAYS AS (CAST(json_extract(event_json, '$.seq') AS INTEGER)) VIRTUAL;

ALTER TABLE agent_events
  ADD COLUMN event_mode TEXT
  GENERATED ALWAYS AS (json_extract(event_json, '$.mode')) VIRTUAL;

CREATE INDEX IF NOT EXISTS idx_agent_events_session_seq
  ON agent_events(session_id, seq, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_events_session_turn_seq
  ON agent_events(session_id, turn_id, seq);

CREATE INDEX IF NOT EXISTS idx_agent_events_session_type_mode_seq
  ON agent_events(session_id, event_type, event_mode, seq);
