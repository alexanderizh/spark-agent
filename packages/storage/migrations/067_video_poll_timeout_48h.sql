-- 067_video_poll_timeout_48h.sql
-- 将历史视频异步轮询的统一默认值从 30 分钟提升到 48 小时。
-- 只改动仍等于旧默认值的配置；用户显式设置的更短/更长值不被覆盖。

UPDATE provider_profiles
SET config_json = json_set(
      config_json,
      '$.mediaDefaults.timeoutMs',
      172800000
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
  AND CAST(json_extract(config_json, '$.mediaDefaults.timeoutMs') AS INTEGER) = 1800000;

UPDATE provider_profiles
SET config_json = json_set(
      config_json,
      '$.mediaDefaults.polling.timeoutMs',
      172800000
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
  AND CAST(json_extract(config_json, '$.mediaDefaults.polling.timeoutMs') AS INTEGER) = 1800000;

UPDATE media_model_manifests
SET manifest_json = json_set(
      manifest_json,
      '$.invocation.polling.timeoutMs',
      172800000
    ),
    updated_at = datetime('now')
WHERE json_valid(manifest_json)
  AND json_extract(manifest_json, '$.invocation.mode') = 'async_polling'
  AND EXISTS (
    SELECT 1
    FROM json_each(manifest_json, '$.domains') AS domain
    WHERE domain.value = 'video'
  )
  AND CAST(json_extract(manifest_json, '$.invocation.polling.timeoutMs') AS INTEGER) = 1800000;
