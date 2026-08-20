-- 会话性能指标（吞吐/TTFT/轮次时长）：每 turn 一行，终态时由
-- TurnRuntimeMetricsTracker 的 onFinalized 汇总写入（SessionService 落库点）。
-- 与 usage_ledger（成本账本，每 API 调用一行）分表：口径与删除策略互不干扰。

CREATE TABLE IF NOT EXISTS turn_perf_metrics (
  id                        TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id                TEXT NOT NULL,
  turn_id                   TEXT NOT NULL,
  provider_id               TEXT NOT NULL,
  model_id                  TEXT NOT NULL,
  terminal_status           TEXT NOT NULL CHECK (terminal_status IN ('completed', 'cancelled', 'error')),
  ttft_ms                   INTEGER,
  stream_active_ms          INTEGER,
  turn_duration_ms          INTEGER,
  output_tokens             INTEGER,
  output_tokens_per_second  REAL,
  request_timestamp         TEXT NOT NULL DEFAULT (datetime('now')),
  created_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 同一 turn 理论上只终态一次；僵尸恢复/重放路径可能重复，upsert 后值覆盖。
CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_perf_session_turn
  ON turn_perf_metrics (session_id, turn_id);

CREATE INDEX IF NOT EXISTS idx_turn_perf_session
  ON turn_perf_metrics (session_id);

CREATE INDEX IF NOT EXISTS idx_turn_perf_provider_model
  ON turn_perf_metrics (provider_id, model_id);
