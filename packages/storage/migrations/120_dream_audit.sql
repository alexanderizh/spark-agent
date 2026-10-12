-- 【AutoDream】梦境提案审计表（可追溯审计闭环）。
-- 背景：被拒/丢弃提案此前只进 dream-audit 应用日志行，用户界面无处可查，
-- 运行报告又只存最近一次（report:{track} 覆盖写）——「提案去哪了」不可追溯。
-- 本表按「每条提案无论去向都记一行」的既有审计口径全量留痕（含历史运行），
-- 与 orchestrator.audit() 的日志行双写；payload_json 为提案原文快照（超长截断）。
CREATE TABLE IF NOT EXISTS dream_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  track TEXT NOT NULL,
  kind TEXT NOT NULL,
  op TEXT NOT NULL,
  outcome TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  target_id TEXT,
  note TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dream_audit_run ON dream_audit(run_id);
CREATE INDEX IF NOT EXISTS idx_dream_audit_track_created ON dream_audit(track, created_at);
