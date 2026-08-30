-- Migration 022: Add is_default column to agents table

ALTER TABLE agents ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_agents_is_default
  ON agents(is_default);
