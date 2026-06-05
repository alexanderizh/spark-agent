-- Migration 020: Normalize legacy non-upload agent avatars to DiceBear URLs.
--
-- Keep manually uploaded avatars intact, but replace missing avatars, old text
-- initials, legacy dicebear configs, and previously generated DiceBear URLs
-- with a fully composed DiceBear URL seeded by the current agent name.

UPDATE agents
SET metadata_json = json_set(
  COALESCE(NULLIF(metadata_json, ''), '{}'),
  '$.avatar',
  json_object(
    'kind', 'url',
    'url',
    'https://api.dicebear.com/9.x/' ||
      CASE abs(length(name) + COALESCE(unicode(substr(name, 1, 1)), 0)) % 7
        WHEN 0 THEN 'adventurer'
        WHEN 1 THEN 'avataaars'
        WHEN 2 THEN 'bottts'
        WHEN 3 THEN 'lorelei'
        WHEN 4 THEN 'micah'
        WHEN 5 THEN 'notionists'
        ELSE 'pixel-art'
      END ||
      '/svg?seed=' || name
  )
)
WHERE json_extract(COALESCE(NULLIF(metadata_json, ''), '{}'), '$.avatar') IS NULL
  OR json_extract(COALESCE(NULLIF(metadata_json, ''), '{}'), '$.avatar.kind') IN ('initial', 'dicebear')
  OR (
    json_extract(COALESCE(NULLIF(metadata_json, ''), '{}'), '$.avatar.kind') = 'url'
    AND json_extract(COALESCE(NULLIF(metadata_json, ''), '{}'), '$.avatar.url') LIKE 'https://api.dicebear.com/9.x/%/svg?seed=%'
  );
