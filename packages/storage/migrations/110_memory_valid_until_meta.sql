-- Migration 110: memory_entry.valid_until + 精度/时区表达（S2.6 / N5）
--
-- 长期记忆生命周期加固（docs/plans/2026-09-26-memory-evidence-and-temporal-semantics.md §5）：
-- 到期时间不再只有"精确瞬时"一种语义 —— 只有日期（"下月起改用新地址"）时
-- 须保存时区与精度，不捏造准确时间（N5：本月仍适用旧值，下月按明确时区切换）。
--
-- 新增两列：
--   - valid_until INTEGER：有效期结束（半开区间 [valid_from, valid_until) 右端，
--     UTC ms）。NULL = 长期（存量行语义）。到期 ≠ 失效：条目保留、历史可查
--     （N10 标注），只是不再作为当前事实注入/检索（N7：旧临时约束不自动恢复）。
--   - valid_until_meta TEXT（JSON）：{"precision":"instant"} 精确 UTC 瞬时
--     （缺省语义）；{"precision":"date","timezone":"Asia/Shanghai"} 仅日期 +
--     IANA 时区 —— 写入侧把"该本地日结束（次日 00:00，exclusive）"换算为
--     UTC 瞬时存入 valid_until，meta 保留原始表达供展示层如实说明。
--
-- 存量数据：全部为 NULL（= 长期 / 无到期），行为不变。

ALTER TABLE memory_entry ADD COLUMN valid_until INTEGER;
ALTER TABLE memory_entry ADD COLUMN valid_until_meta TEXT;
