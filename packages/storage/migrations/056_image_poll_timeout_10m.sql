-- 056_image_poll_timeout_10m.sql
-- 将历史图片模型的旧默认轮询超时（4 分钟）升级为 10 分钟。
--
-- 仅替换精确等于旧默认值 240000ms 的记录，保留用户显式设置的其他超时。

UPDATE provider_profiles
SET config_json = json_set(
      config_json,
      '$.mediaDefaults.polling.timeoutMs',
      600000
    ),
    updated_at = datetime('now')
WHERE json_valid(config_json)
  AND (
    json_extract(config_json, '$.modelType') = 'image'
    OR json_extract(config_json, '$.imageProvider') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM json_each(config_json, '$.mediaCapabilities') AS capability
      WHERE capability.value LIKE 'image.%'
    )
  )
  AND CAST(json_extract(config_json, '$.mediaDefaults.polling.timeoutMs') AS INTEGER) = 240000;

UPDATE media_model_manifests
SET manifest_json = json_set(
      manifest_json,
      '$.invocation.polling.timeoutMs',
      600000
    ),
    updated_at = datetime('now')
WHERE json_valid(manifest_json)
  AND json_extract(manifest_json, '$.invocation.mode') = 'async_polling'
  AND EXISTS (
    SELECT 1
    FROM json_each(manifest_json, '$.domains') AS domain
    WHERE domain.value = 'image'
  )
  AND CAST(json_extract(manifest_json, '$.invocation.polling.timeoutMs') AS INTEGER) = 240000;
