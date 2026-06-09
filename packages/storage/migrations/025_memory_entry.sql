-- Memory entry table for the Agent Memory System.
-- Stores structured memory entries (user / project / agent scope) with SQLite indexing.
-- Each entry also has a corresponding markdown file on disk for human readability.

CREATE TABLE IF NOT EXISTS memory_entry (
  id            TEXT PRIMARY KEY,             -- usr_xxx / prj_xxx / agt_xxx
  scope         TEXT NOT NULL CHECK(scope IN ('user','project','agent')),
  scope_ref     TEXT,                          -- workspace_id / agent_id; NULL for user scope
  type          TEXT NOT NULL CHECK(type IN ('user','feedback','project','reference')),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  file_path     TEXT NOT NULL,                 -- absolute path to markdown file
  confidence    REAL NOT NULL DEFAULT 1.0,
  hit_count     INTEGER NOT NULL DEFAULT 0,
  last_hit_at   INTEGER,                       -- unix epoch ms
  source_session_id TEXT,
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,              -- unix epoch ms
  updated_at    INTEGER NOT NULL               -- unix epoch ms
);

-- Unique name within (scope, scope_ref) for non-archived entries
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mem_name
  ON memory_entry(scope, scope_ref, name) WHERE archived = 0;

-- Fast lookup by scope + archived status
CREATE INDEX IF NOT EXISTS idx_mem_scope_archived
  ON memory_entry(scope, scope_ref, archived);

-- Fast lookup by scope + type
CREATE INDEX IF NOT EXISTS idx_mem_scope_type
  ON memory_entry(scope, type, archived);
