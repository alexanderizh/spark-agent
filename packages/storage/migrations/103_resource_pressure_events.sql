-- Migration 103: resource_pressure_events
--
-- 资源压力级别变更事件（性能监控与并发控制体系 · 模块一，M1）。
-- 只落级别变更事件（nominal/warning/critical/emergency 之间的迁移），
-- 分钟级指标持久化默认关闭（内存环形缓冲为主，见方案 §3.5）。

CREATE TABLE IF NOT EXISTS resource_pressure_events (
  id TEXT PRIMARY KEY,
  from_level TEXT NOT NULL,
  to_level TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  indicators_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resource_pressure_events_occurred_at
  ON resource_pressure_events (occurred_at);
