-- Durable turn intake queue. Runtime preparation happens after the IPC acceptance boundary.

CREATE TABLE turn_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted',
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_turn_requests_session_status_created
  ON turn_requests(session_id, status, created_at);

CREATE INDEX idx_turn_requests_status_created
  ON turn_requests(status, created_at);
