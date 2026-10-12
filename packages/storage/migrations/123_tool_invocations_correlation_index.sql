-- 123: tool_invocations 找回 correlation_id 单列索引。
--
-- 背景（审查 P3-5）：121 重建表时 093 的 idx_tool_invocations_correlation
-- 未随迁（部分唯一索引 uniq_tool_invocations_correlation_running 只覆盖
-- running 行），list({ correlationId }) / listLedger({ correlationId }) 与
-- finalizeByCorrelation 的按 correlation_id 定位退化为全表扫描。
-- 该索引同时服务 finalizeByCorrelation 的配对查询（每次工具调用收尾一次）。

CREATE INDEX IF NOT EXISTS idx_tool_invocations_correlation
  ON tool_invocations (correlation_id);
