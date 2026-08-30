-- 038: 修正 SkillHub 市场源的 api_base_url
--
-- 早期 ensureDefaults 把 skillhub 的 apiBaseUrl 写成了网页 host https://skillhub.cn，
-- 该 host 只有 SPA、没有 JSON API，导致 SkillHubAdapter 的 search/featured 全部静默失败。
-- 真正的 API host 是 https://api.skillhub.cn。
-- 新库由 ensureDefaults 直接写入正确值；这里用补偿 UPDATE 修正老库的错误记录。
-- WHERE 限定只改写错误值的行，绝不覆盖用户自定义的其它源 / 已修正的源。

UPDATE skill_registries
SET api_base_url = 'https://api.skillhub.cn',
    updated_at = datetime('now')
WHERE id = 'skillhub'
  AND api_base_url IN ('https://skillhub.cn', 'https://www.skillhub.cn');
