-- Session conversation summarization cache
-- Stores LLM-generated summaries of older conversation turns to replace windowed truncation.

CREATE TABLE IF NOT EXISTS session_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  summary_turn_id TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  summarized_entry_count INTEGER NOT NULL,
  summarized_from_seq INTEGER NOT NULL,
  summarized_to_seq INTEGER NOT NULL,
  estimated_tokens INTEGER NOT NULL,
  model_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_session_summaries_session
  ON session_summaries(session_id, summarized_to_seq DESC);
