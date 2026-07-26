-- 061: 会话内容搜索 FTS5 索引
--
-- 背景：会话搜索原本是 `event_json LIKE '%q%'` 全表扫描，四个问题叠加：
--   1. agent_events 是全库最大的表，无索引可用；better-sqlite3 同步执行，
--      会话量上来后搜索直接冻住主进程；
--   2. 匹配的是序列化后的 JSON 原文，会命中字段名、工具参数、文件路径、base64；
--   3. snippet 是 JSON 字符串裸切，用户看到的是 `..."content":"...` 这种乱码；
--   4. `%` `_` 未转义，用户搜 `%` 会匹配全库。
--
-- 方案：contentless FTS5（与 042 的 memory_fts 同一套范式），只索引
-- user_message / assistant_message 的**纯文本正文**。
--
-- 写入内容必须先过 segmentCjk()（CJK 逐字预分词，见 @spark/storage segment-cjk），
-- tokenizer 保持 unicode61；查询侧用 buildFtsMatchQuery() 包成短语。
-- 写入与查询两侧分词不一致会导致查不到，这是硬约束。
--
-- 存量事件的回填不能在纯 SQL 里做（需要 JS 侧 segmentCjk + 事件正文解析），
-- 由 EventRepository.backfillSearchIndexIfNeeded() 在代码侧分批完成，
-- 以 app_settings(session-search / ftsBackfillDone) 标记幂等。

CREATE VIRTUAL TABLE IF NOT EXISTS agent_event_fts USING fts5(
  body,
  content='',
  contentless_delete=1,
  tokenize='unicode61'
);

-- rowid ↔ event_id 映射。
--
-- 为什么不复用 agent_events 的隐式 rowid：contentless FTS5 需要稳定的 rowid，
-- 而事件删除（清空会话/删除消息/后台批量清理）后 agent_events 的 rowid 会被复用，
-- 复用会让 FTS 里的旧条目指向新事件，搜出完全无关的结果。独立映射表 + 显式
-- ON DELETE CASCADE 让「事件没了，索引项也必然没了」。
CREATE TABLE IF NOT EXISTS agent_event_fts_map (
  rowid      INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_event_fts_map_session
  ON agent_event_fts_map(session_id);

-- 删除同步用触发器而非 JS。
--
-- agent_events 有 5 条不同的删除路径（deleteBySession / deleteBySessionBatch /
-- deleteOrphanedSessionEventsBatch / deleteTransientDeltasBatch / deleteEventsByIds），
-- 其中多数按 rowid 批量删、拿不到 event_id。在 JS 侧逐个补同步既容易漏，
-- 也挡不住以后新增的删除路径。放在触发器里，「事件没了索引项必然没了」由数据库保证。
CREATE TRIGGER IF NOT EXISTS agent_events_fts_after_delete
AFTER DELETE ON agent_events
BEGIN
  DELETE FROM agent_event_fts
   WHERE rowid = (SELECT rowid FROM agent_event_fts_map WHERE event_id = old.id);
  DELETE FROM agent_event_fts_map WHERE event_id = old.id;
END;
