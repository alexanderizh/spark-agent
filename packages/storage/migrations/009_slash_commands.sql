-- Migration 009: Slash Commands
CREATE TABLE IF NOT EXISTS slash_commands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  handler_type TEXT NOT NULL DEFAULT 'builtin',
  parameters TEXT NOT NULL DEFAULT '{}',
  is_dangerous INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
