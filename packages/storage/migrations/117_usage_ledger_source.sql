-- 【AutoDream】usage_ledger 增加 source 维度列（todo/2026-10-10 §12-2 已拍板项）。
-- 用途：梦境整理会话（source='dream'）与用户正常会话（source='api'）的用量分账，
-- 统计侧默认只看 'api'，避免自动整理消耗污染正常用量统计；'dream' 维度可单独
-- 查询（设置页「累计整理消耗」）。默认值保证存量行与既有写入路径零迁移语义。
ALTER TABLE usage_ledger ADD COLUMN source TEXT NOT NULL DEFAULT 'api';
