-- 081: append-only replay timeline, branches and versioned team playbooks.
-- The tables deliberately keep the discussion scope on every row.  The
-- storage service is the authority for scope and capability checks; SQLite
-- constraints provide the second line of defence for idempotency and CAS
-- projections.

CREATE TABLE IF NOT EXISTS replay_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('task','handoff','deliberation','ledger','tool','manual')),
  source_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  event_time TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  origin_event_id TEXT,
  op_id TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, room_id, discussion_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_replay_events_scope_seq
  ON replay_events(session_id, room_id, discussion_id, seq);
CREATE INDEX IF NOT EXISTS idx_replay_events_scope_time
  ON replay_events(session_id, room_id, discussion_id, event_time, id);

CREATE TABLE IF NOT EXISTS replay_branches (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  source_discussion_id TEXT NOT NULL,
  source_seq INTEGER NOT NULL CHECK (source_seq >= 0),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  op_id TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  UNIQUE(session_id, room_id, discussion_id, id)
);

CREATE INDEX IF NOT EXISTS idx_replay_branches_scope
  ON replay_branches(session_id, room_id, discussion_id, created_at, id);

CREATE TABLE IF NOT EXISTS replay_playbooks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('proposed','published','archived')),
  name TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  handoff_rules_json TEXT NOT NULL,
  gate_rules_json TEXT NOT NULL,
  deliberation_rules_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_replay_playbooks_scope
  ON replay_playbooks(session_id, room_id, discussion_id, updated_at, id);

CREATE TABLE IF NOT EXISTS replay_playbook_versions (
  id TEXT PRIMARY KEY,
  playbook_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('proposed','published','archived')),
  name TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  handoff_rules_json TEXT NOT NULL,
  gate_rules_json TEXT NOT NULL,
  deliberation_rules_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('propose','publish','archive')),
  op_id TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  UNIQUE(session_id, room_id, discussion_id, playbook_id, version)
);

CREATE INDEX IF NOT EXISTS idx_replay_playbook_versions_scope
  ON replay_playbook_versions(session_id, room_id, discussion_id, playbook_id, version);

-- Lifecycle mutations are kept separately from immutable version snapshots so
-- publish/archive can retain their own idempotency records and CAS evidence.
CREATE TABLE IF NOT EXISTS replay_playbook_operations (
  id TEXT PRIMARY KEY,
  playbook_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  operation TEXT NOT NULL CHECK (operation IN ('propose','publish','archive')),
  actor TEXT NOT NULL,
  op_id TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_replay_playbook_operations_scope
  ON replay_playbook_operations(session_id, room_id, discussion_id, playbook_id, version);

CREATE TABLE IF NOT EXISTS replay_playbook_applications (
  id TEXT PRIMARY KEY,
  playbook_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  target_discussion_id TEXT NOT NULL,
  playbook_version INTEGER NOT NULL CHECK (playbook_version > 0),
  applied_by TEXT NOT NULL,
  op_id TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_replay_playbook_applications_scope
  ON replay_playbook_applications(session_id, room_id, discussion_id, created_at, id);
