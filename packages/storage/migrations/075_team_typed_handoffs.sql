CREATE TABLE team_handoffs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  task_id TEXT,
  dispatch_id TEXT,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  expected_output TEXT NOT NULL,
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  deadline TEXT,
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('public','internal','confidential','restricted')),
  status TEXT NOT NULL CHECK (status IN ('draft','submitted','accepted','needs_clarification','rejected','completed','canceled')),
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_team_handoffs_scope
  ON team_handoffs(session_id, room_id, discussion_id, created_at, id);

CREATE TABLE team_handoff_events (
  id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  op_id TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL CHECK (operation IN ('create','submit','accept','request_clarification','reject','complete','cancel')),
  actor_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_team_handoff_events_scope
  ON team_handoff_events(session_id, room_id, discussion_id, created_at, id);
CREATE INDEX idx_team_handoff_events_handoff
  ON team_handoff_events(handoff_id, created_at, id);
