-- Migration 102: Deprecate legacy Auto Router routing cards
--
-- 旧 Auto Router（伪 provider + model_profiles 路由卡）整体下线，废弃清理策略：
-- 仅将 kind='router' 的路由卡标记 enabled=0 停用，不物理删除（保守可回滚），
-- 也不生成新的 auto-router Provider 行 —— 需要 AutoRouter 的用户在管理页重新创建。
-- 引用旧魔法 id（claude-auto-router / codex-auto-router）的存量会话由运行时
-- 解析处回退默认渠道（session.service 旧 id 识别分支），本迁移不改写会话数据。

UPDATE model_profiles
SET enabled = 0,
    updated_at = datetime('now')
WHERE enabled = 1
  AND json_extract(config_json, '$.kind') = 'router';
