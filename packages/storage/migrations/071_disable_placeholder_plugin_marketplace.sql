-- The original bundled plugin marketplace URL is a placeholder, not a deployed service.
-- Keep the row for future explicit configuration, but do not present it as available.
UPDATE plugin_registries
SET enabled = 0,
    updated_at = datetime('now')
WHERE id = 'spark-official'
  AND api_base_url = 'https://plugins.spark-agent.com/v1'
  AND trusted_key_fingerprints_json = '[]';
