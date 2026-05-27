-- P3-08: Application settings persistence
-- Stores user settings as key-value pairs with category grouping.
-- Each category (general, appearance, telemetry, updates) maps to one JSON value.

CREATE TABLE IF NOT EXISTS app_settings (
  category TEXT NOT NULL,
  key      TEXT NOT NULL,
  value    TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (category, key)
);

-- Index for category-level queries (e.g., "get all general settings")
CREATE INDEX IF NOT EXISTS idx_app_settings_category
  ON app_settings (category);
