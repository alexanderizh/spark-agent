CREATE TABLE deliberations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  proposal_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  alternatives_json TEXT NOT NULL,
  risks_json TEXT NOT NULL,
  decision_json TEXT,
  owner_id TEXT,
  deadline TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed','decided','conflicted','superseded')),
  capability TEXT NOT NULL CHECK (capability IN ('agent','system','user')),
  conflict_json TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_deliberations_scope
  ON deliberations(session_id, room_id, discussion_id, created_at, id);
CREATE INDEX idx_deliberations_topic
  ON deliberations(session_id, room_id, discussion_id, topic, status);

CREATE TABLE deliberation_conflicts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  record_ids_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_deliberation_conflicts_scope
  ON deliberation_conflicts(session_id, room_id, discussion_id, created_at, id);

CREATE TABLE deliberation_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  deliberation_id TEXT NOT NULL,
  op_id TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN ('agent','system','user')),
  request_json TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_deliberation_events_scope
  ON deliberation_events(session_id, room_id, discussion_id, deliberation_id, created_at, id);
