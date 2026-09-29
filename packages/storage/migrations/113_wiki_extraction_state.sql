-- 113_wiki_extraction_state.sql
-- 知识库抽取管道（S2）：增量水位线与运行计数。
--
-- 为什么单独一张表：抽取必须**增量**（方案 §9.3「记录 lastExtractedTurnIndex，
-- 只喂新增轮次，不整段重跑」）。水位线是「每个会话跑到第几轮」的运行状态，
-- 既不是知识内容（不能进 wiki_page），也不是用户偏好（不能进 app_settings）。
--
-- 只记录已**成功抽取过**的水位线：失败不推进，下次重试会重跑同一批轮次
-- （候选按 content_digest 去重，重复抽取不会刷屏）。

CREATE TABLE IF NOT EXISTS wiki_extraction_state (
  session_id      TEXT PRIMARY KEY,
  scope           TEXT NOT NULL,
  scope_ref       TEXT,
  last_turn_index INTEGER NOT NULL DEFAULT 0,
  last_run_at     INTEGER,
  last_trigger    TEXT,                       -- manual / milestone / idle / schedule
  run_count       INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT                        -- 仅失败原因分类，不含正文片段
);

CREATE INDEX IF NOT EXISTS idx_wiki_extract_state_scope
  ON wiki_extraction_state(scope, scope_ref, last_run_at);
