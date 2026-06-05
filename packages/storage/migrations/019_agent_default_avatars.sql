-- Migration 019: Populate default DiceBear avatars for agents without avatars.
--
-- Renderer-side creation stores a fully composed DiceBear URL:
--   https://api.dicebear.com/9.x/{style}/svg?seed={nickname}
--
-- SQLite cannot URL-encode arbitrary unicode names, so this migration stores
-- the raw name in the URL for legacy rows. Browsers encode it when requesting;
-- the renderer also has an image fallback to avoid broken UI if a network load
-- fails. The live local database repair script uses encodeURIComponent.

UPDATE agents
SET metadata_json = json_set(
  COALESCE(NULLIF(metadata_json, ''), '{}'),
  '$.avatar',
  json_object(
    'kind', 'url',
    'url', 'https://api.dicebear.com/9.x/bottts/svg?seed=' || name
  )
)
WHERE json_extract(COALESCE(NULLIF(metadata_json, ''), '{}'), '$.avatar') IS NULL;
