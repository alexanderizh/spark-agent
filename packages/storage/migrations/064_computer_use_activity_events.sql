-- Durable, content-light Computer Use activity timeline.
-- Event payloads contain ids/status/diagnostics only; screenshots and accessible text remain
-- in the encrypted snapshot vault and are referenced separately.

CREATE TABLE computer_use_activity_events (
  id                   TEXT PRIMARY KEY,
  computer_session_id  TEXT NOT NULL,
  session_id           TEXT NOT NULL,
  turn_id              TEXT NOT NULL,
  seq                  INTEGER NOT NULL CHECK (seq >= 0),
  event_type           TEXT NOT NULL,
  event_json           TEXT NOT NULL CHECK (json_valid(event_json)),
  created_at           TEXT NOT NULL,
  UNIQUE (computer_session_id, seq),
  FOREIGN KEY (computer_session_id) REFERENCES computer_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_computer_use_activity_session_seq
  ON computer_use_activity_events(computer_session_id, seq);

CREATE INDEX idx_computer_use_activity_chat_created
  ON computer_use_activity_events(session_id, created_at);
