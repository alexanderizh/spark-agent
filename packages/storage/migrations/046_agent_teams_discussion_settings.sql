-- Migration 046: Persist team discussion settings on long-lived teams
--
-- 给 agent_teams 增加：
-- - max_discussion_rounds: 讨论轮数上限（默认 6）
-- - enable_peer_messaging: 是否允许成员互发消息（默认 false）
--
-- 老数据采用与当前运行时兼容的默认值，避免已有团队行为发生变化。

ALTER TABLE agent_teams
  ADD COLUMN max_discussion_rounds INTEGER NOT NULL DEFAULT 6;

ALTER TABLE agent_teams
  ADD COLUMN enable_peer_messaging INTEGER NOT NULL DEFAULT 0;

UPDATE agent_teams
SET
  max_discussion_rounds = COALESCE(max_discussion_rounds, 6),
  enable_peer_messaging = COALESCE(enable_peer_messaging, 0);
