-- 055_video_poll_timeout_30m.sql
-- 视频异步任务默认至少允许轮询 30 分钟。
--
-- 只抬高缺失或小于 30 分钟的历史视频配置；用户/provider 已配置的更长超时保留。

UPDATE provider_profiles
SET config_json = json_set(
      config_json,
      '$.mediaDefaults.polling.timeoutMs',
      1800000
    ),
    updated_at = datetime('now')
WHERE json_valid(config_json)
  AND (
    json_extract(config_json, '$.modelType') = 'video'
    OR EXISTS (
      SELECT 1
      FROM json_each(config_json, '$.mediaCapabilities') AS capability
      WHERE capability.value LIKE 'video.%'
    )
  )
  AND COALESCE(
    CAST(json_extract(config_json, '$.mediaDefaults.polling.timeoutMs') AS INTEGER),
    0
  ) < 1800000;

-- 自定义/历史 catalog manifest 也同步修复。内置 manifest 启动时仍会由源码重新 seed，
-- 这里保证升级后的首次读取和用户自定义视频 manifest 都立即获得一致默认值。
UPDATE media_model_manifests
SET manifest_json = json_set(
      manifest_json,
      '$.invocation.polling.timeoutMs',
      1800000
    ),
    updated_at = datetime('now')
WHERE json_valid(manifest_json)
  AND json_extract(manifest_json, '$.invocation.mode') = 'async_polling'
  AND EXISTS (
    SELECT 1
    FROM json_each(manifest_json, '$.domains') AS domain
    WHERE domain.value = 'video'
  )
  AND COALESCE(
    CAST(json_extract(manifest_json, '$.invocation.polling.timeoutMs') AS INTEGER),
    0
  ) < 1800000;
