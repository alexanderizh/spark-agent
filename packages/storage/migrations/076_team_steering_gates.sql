CREATE TABLE team_steering_gates (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('ledger','record','artifact','handoff','task')),
  target_id TEXT NOT NULL,
  trigger_text TEXT NOT NULL,
  reason TEXT NOT NULL,
  impact TEXT NOT NULL CHECK (impact IN ('low','medium','high','critical')),
  budget_snapshot_json TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting','approved','revise','stopped','expired')),
  capability TEXT NOT NULL CHECK (capability IN ('agent','system','user')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_team_steering_gates_scope
  ON team_steering_gates(session_id, room_id, discussion_id, created_at, id);

CREATE TABLE team_steering_gate_events (
  id TEXT PRIMARY KEY,
  gate_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  op_id TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL CHECK (operation IN ('create','approve','revise','stop','expire')),
  actor_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN ('agent','system','user')),
  high_impact INTEGER NOT NULL CHECK (high_impact IN (0,1)),
  record_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_team_steering_gate_events_scope
  ON team_steering_gate_events(session_id, room_id, discussion_id, created_at, id);
CREATE INDEX idx_team_steering_gate_events_gate
  ON team_steering_gate_events(gate_id, created_at, id);
