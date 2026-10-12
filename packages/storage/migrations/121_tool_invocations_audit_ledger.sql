-- 121: tool_invocations 升级为可审计工具执行账本（哈希链 + 关联模型 + 全来源覆盖）。
--
-- 背景（设计方案：todo/2026-10-12-会话检查器工具执行日志审计系统设计方案.md §4.1）：
--   F1 093 的 invocation_source CHECK 漏 'hook'，hook 来源插入即违约；
--   F2 result_archived/result_truncated/retry_count 从未真实置位；
--   F3 账本无保留期治理，无限增长；
--   F5 input_sha256 口径不一（非规范化哈希）。
-- 本迁移把表重建为审计账本：加 ledger_seq/哈希链列、成员与引擎归因列、
-- 载荷内容寻址列；CHECK 扩值（source_kind 8 值 / invocation_source 6 值 / status 增 'stale'）。
--
-- SQLite 无法 ALTER CHECK，按 118 先例重建：建新表 → 拷贝存量 → DROP → RENAME → 重建索引。
-- 099 追加的 hook_id/hook_run_id 列与 idx_tool_invocations_hook 必须保留。
--
-- 回填口径：
--   ledger_seq 按原 created_at, id 顺序重编（全局单调，新写入方取 MAX+1 续号）；
--   chain_session_id = session_id，无会话的工作流调用为 'wf:'||workflow_id，两者皆无为 'unattributed'；
--   旧行 record_hash/prev_hash/finished_record_hash 置 NULL —— 链校验遇 NULL record_hash
--   即视为新链起点，回填段豁免（校验从迁移后第一条新记录起算）。
--
-- 唯一性说明：correlation_id 的唯一索引做成「running 态部分唯一」——同一 correlation_id
-- 同一时刻至多一条 running 行（finalizeByCorrelation 配对与采集点去重依赖此不变量），
-- 而重试允许以相同 correlation_id 追加新的终态行（保留重试历史）。

CREATE TABLE tool_invocations_new (
  id                    TEXT PRIMARY KEY,            -- UUIDv4（外部引用键）
  -- ledger_seq/chain_session_id 带 DEFAULT 仅为「修复库重放旧 migration」留活路：
  -- 095 回填的 INSERT 列清单不含这两列，重放（schema_migrations 记录被修复删除后重跑）
  -- 若无默认值会 NOT NULL 违约崩库。DEFAULT 0 同时是可审计的「重放行」标记
  -- （正常路径 seq 从 1 起，appendLedger MAX+1 不受影响）。
  ledger_seq            INTEGER NOT NULL DEFAULT 0,  -- 全局单调序号（appendLedger 同事务 MAX+1）
  correlation_id        TEXT,                        -- tool_call 事件 id / 目录调用 id；跨表关联与去重键
  chain_session_id      TEXT NOT NULL DEFAULT 'unattributed',  -- 哈希链分链键（= session_id；工作流 'wf:'||workflow_id；无归因 'unattributed'）
  prev_hash             TEXT,                        -- 链上前一条 record_hash（分链首条为 NULL）
  record_hash           TEXT,                        -- 本条创建态内容哈希（含 prev_hash）
  finished_record_hash  TEXT,                        -- 收尾态补充哈希（finish/reconcileStale 推进时写入）
  -- 归因
  session_id            TEXT,
  turn_id               TEXT,
  project_id            TEXT,
  agent_id              TEXT,
  workflow_id           TEXT,
  member_agent_id       TEXT,                        -- TeamMemberEventContext.memberAgentId
  dispatch_id           TEXT,                        -- TeamMemberEventContext.dispatchId
  hook_id               TEXT,
  hook_run_id           TEXT,
  -- 工具身份
  tool_id               TEXT,
  tool_name             TEXT NOT NULL,
  source_kind           TEXT NOT NULL CHECK (source_kind IN (
                          'sdk-builtin', 'mcp', 'custom-tool', 'tool-package',
                          'connector', 'workflow', 'hook', 'test')),
  invocation_source     TEXT NOT NULL CHECK (invocation_source IN (
                          'model', 'workflow', 'test', 'platform', 'nested', 'hook')),
  mcp_server_id         TEXT,                        -- mcp__<server>__<tool> 解析出的 server 段
  engine                TEXT,                        -- 'claude' | 'codex' | 'spark'（模型路径才有）
  source_id             TEXT NOT NULL,
  package_id            TEXT,
  version               TEXT,
  adapter               TEXT,
  -- 生命周期
  status                TEXT NOT NULL CHECK (status IN (
                          'running', 'ok', 'error', 'timeout', 'denied', 'cancelled', 'stale')),
  started_at            TEXT NOT NULL,
  finished_at           TEXT,
  duration_ms           INTEGER,
  error_code            TEXT,
  error_message         TEXT,                        -- 脱敏后截断（≤2000 字符）
  retry_count           INTEGER NOT NULL DEFAULT 0,
  -- 载荷（全部脱敏后）
  input_sha256          TEXT,                        -- canonical-json 规范化哈希
  input_bytes           INTEGER,
  input_artifact_id     TEXT,                        -- 内容寻址归档 id（超内联阈值才有）
  output_bytes          INTEGER,
  output_sha256         TEXT,
  output_artifact_id    TEXT,
  result_truncated      INTEGER NOT NULL DEFAULT 0 CHECK (result_truncated IN (0, 1)),
  result_archived       INTEGER NOT NULL DEFAULT 0 CHECK (result_archived IN (0, 1)),
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO tool_invocations_new (
  id, ledger_seq, correlation_id, chain_session_id,
  session_id, turn_id, project_id, agent_id, workflow_id, hook_id, hook_run_id,
  tool_id, tool_name, source_kind, invocation_source, source_id, package_id, version, adapter,
  status, started_at, finished_at, duration_ms, error_code, retry_count,
  input_sha256, output_bytes, result_truncated, result_archived, created_at
)
SELECT
  id,
  ROW_NUMBER() OVER (ORDER BY created_at, id),
  correlation_id,
  CASE
    WHEN session_id IS NOT NULL THEN session_id
    WHEN workflow_id IS NOT NULL THEN 'wf:' || workflow_id
    ELSE 'unattributed'
  END,
  session_id, turn_id, project_id, agent_id, workflow_id, hook_id, hook_run_id,
  tool_id, tool_name, source_kind, invocation_source, source_id, package_id, version, adapter,
  status, started_at, finished_at, duration_ms, error_code, retry_count,
  input_sha256, output_bytes, result_truncated, result_archived, created_at
FROM tool_invocations;

-- 建唯一索引前的悬挂对账：存量数据若存在同一 correlation_id 多条 running
-- （崩溃悬挂 + 重试共存），保留 ledger_seq 最新一条，其余对账为 'stale'，
-- 否则部分唯一索引创建失败会阻断整个升级。
UPDATE tool_invocations_new
SET status = 'stale'
WHERE status = 'running'
  AND correlation_id IS NOT NULL
  AND ledger_seq NOT IN (
    SELECT MAX(ledger_seq) FROM tool_invocations_new
    WHERE status = 'running' AND correlation_id IS NOT NULL
    GROUP BY correlation_id
  );

DROP TABLE tool_invocations;
ALTER TABLE tool_invocations_new RENAME TO tool_invocations;

-- 哈希链游走：分链内按 ledger_seq 顺序取前一条 record_hash
CREATE INDEX idx_tool_invocations_chain ON tool_invocations(chain_session_id, ledger_seq);

-- running 态配对不变量：同一 correlation_id 至多一条 running（重试追加终态行不受限）
CREATE UNIQUE INDEX uniq_tool_invocations_correlation_running
  ON tool_invocations(correlation_id)
  WHERE correlation_id IS NOT NULL AND status = 'running';
-- 检查器时间线：轮次分组 + 时序
CREATE INDEX idx_tool_invocations_turn ON tool_invocations(session_id, turn_id, ledger_seq);
-- 工具维度过滤
CREATE INDEX idx_tool_invocations_tool ON tool_invocations(tool_name, created_at);
-- 既有查询面保留（list 的 source 诊断过滤 / status 过滤 / hook 归因 / 全局清理扫描）
CREATE INDEX idx_tool_invocations_source ON tool_invocations(source_kind, source_id, created_at);
CREATE INDEX idx_tool_invocations_status ON tool_invocations(status, created_at);
CREATE INDEX idx_tool_invocations_hook ON tool_invocations(hook_id, started_at);
CREATE INDEX idx_tool_invocations_created ON tool_invocations(created_at);
