-- 060_media_interface_timeout.sql
-- 将历史 Provider 轮询超时复制为同步/异步统一接口超时。
-- 保留旧字段供旧版本兼容；已有顶层 timeoutMs 时不得覆盖。

UPDATE provider_profiles
SET config_json = json_set(
      config_json,
      '$.mediaDefaults.timeoutMs',
      CAST(json_extract(config_json, '$.mediaDefaults.polling.timeoutMs') AS INTEGER)
    ),
    updated_at = datetime('now')
WHERE json_valid(config_json)
  AND json_type(config_json, '$.mediaDefaults.timeoutMs') IS NULL
  AND json_type(config_json, '$.mediaDefaults.polling.timeoutMs') IN ('integer', 'real')
  AND CAST(
        json_extract(config_json, '$.mediaDefaults.polling.timeoutMs') AS INTEGER
      ) BETWEEN 1000 AND 172800000;
