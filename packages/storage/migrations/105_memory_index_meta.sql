-- Migration 105: 记忆索引元数据表（S1B.2 索引新鲜度）
--
-- 长期记忆生命周期加固（docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md S1B 切片 2）：
-- 每条记忆的每种索引（vec / fts）各自记录建立时的输入摘要与来源配置，
-- 用于三件事：
--   1. 向量新鲜度判定（E5）：条目文本更新后 embedding 输入哈希失配，
--      条目重新进入懒回填队列，旧向量不再永久滞留；
--   2. 晚到覆盖防护（E6）：回填请求时捕获的输入哈希与完成时条目当前
--      哈希比对，失配拒绝写入，晚到旧文本向量不占位；
--   3. 配置代际（同维度模型切换）：ensureVecTable 从只比维度升级为
--      比代际+维度+provider/model，切换即整体重建并递增 generation，
--      旧向量与新向量不混用（供应商未暴露 revision 时不承诺识别其
--      静默更新，rebuildVecTable 保留人工重建入口）。
-- FTS 行（index_kind='fts'）无模型依赖，仅记录输入摘要与 built_at，
-- 用于迁移清单校验与诊断。

CREATE TABLE IF NOT EXISTS memory_index_meta (
  memory_id TEXT NOT NULL,
  index_kind TEXT NOT NULL CHECK (index_kind IN ('vec', 'fts')),
  input_hash TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  model_revision TEXT,
  preprocessor_version TEXT,
  config_generation INTEGER NOT NULL DEFAULT 0,
  built_at INTEGER NOT NULL,
  PRIMARY KEY (memory_id, index_kind)
);

CREATE INDEX IF NOT EXISTS idx_memory_index_meta_generation
  ON memory_index_meta (index_kind, config_generation);
