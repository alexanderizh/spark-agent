-- 122: tool_invocations 补 ledger_seq 单列索引。
--
-- 背景（审查 D3）：appendLedger 分配全局序号用 SELECT COALESCE(MAX(ledger_seq),0)+1，
-- SQLite 的 min/max 优化只对以目标列为首列的索引生效——121 建的索引首列均为
-- chain_session_id / session_id，该查询退化为全表扫描，随账本行数线性恶化
-- （每次工具调用同步执行一次，重度使用账本可达百万行级）。
-- 单列索引让 MAX(ledger_seq) 回到 O(log n)，同时利好无会话过滤的
-- ORDER BY ledger_seq 查询（导出/全链翻页）。

CREATE INDEX IF NOT EXISTS idx_tool_invocations_ledger_seq
  ON tool_invocations (ledger_seq);
