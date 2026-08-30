-- 044: Team A2A 升级 — 共享讨论线程（team_discussions / team_thread_messages）
--
-- 让团队模式从"Host 单向 dispatch + Member 原路回复"升级为真正的多 Agent 协作：
-- 一场讨论（discussionId）跨多次 dispatch / 用户 turn 延续，所有消息追加进同一条
-- 共享时间线，被调度者 prompt 渲染时按 token 预算截断（近 N 条 + 历史轮 summary 锚点）。
--
-- team_discussions: 一场讨论的状态（轮次/收尾），由 Host 首次注入团队工具时创建。
-- team_thread_messages: 讨论内的所有消息（Host 派发回执、成员回复、成员间对等消息）。

CREATE TABLE IF NOT EXISTS team_discussions (
  id              TEXT PRIMARY KEY,                  -- discussionId
  session_id      TEXT NOT NULL,
  host_agent_id   TEXT NOT NULL,
  topic           TEXT,
  round_index     INTEGER NOT NULL DEFAULT 0,
  max_rounds      INTEGER NOT NULL,
  state           TEXT NOT NULL CHECK(state IN ('active','concluded','canceled')),
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at        TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_discussions_session
  ON team_discussions(session_id, started_at);
-- 找会话内当前 active 讨论（用户新 turn 延续同一讨论的查询路径）
CREATE INDEX IF NOT EXISTS idx_team_discussions_active
  ON team_discussions(session_id, state, started_at);

CREATE TABLE IF NOT EXISTS team_thread_messages (
  id               TEXT PRIMARY KEY,
  discussion_id    TEXT NOT NULL,
  sender_agent_id  TEXT NOT NULL,
  target_agent_id  TEXT,                              -- NULL = 广播
  round_index      INTEGER NOT NULL,
  -- kind 区分消息来源：host_dispatch（Host 派发回执）/ member_reply（成员回复）/
  -- peer_message（成员对等消息）/ round_summary（team_round_advance 写入的本轮小结）
  kind             TEXT NOT NULL CHECK(kind IN ('host_dispatch','member_reply','peer_message','round_summary')),
  content          TEXT NOT NULL,
  -- 可选：关联的 dispatch（用于回溯某条消息对应哪次执行）
  dispatch_id      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (discussion_id) REFERENCES team_discussions(id) ON DELETE CASCADE
);

-- 时间线渲染主索引：按讨论 + 创建时间排序
CREATE INDEX IF NOT EXISTS idx_team_thread_discussion
  ON team_thread_messages(discussion_id, created_at);
-- 按 dispatch 反查（dispatch 完成时回写线程）
CREATE INDEX IF NOT EXISTS idx_team_thread_dispatch
  ON team_thread_messages(discussion_id, dispatch_id);
