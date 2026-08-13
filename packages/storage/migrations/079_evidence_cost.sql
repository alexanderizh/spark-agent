CREATE TABLE evidence_cost_evidence (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, room_id TEXT NOT NULL, discussion_id TEXT NOT NULL,
  claim TEXT NOT NULL, links_json TEXT NOT NULL, source_json TEXT NOT NULL, version_label TEXT,
  summary TEXT NOT NULL, hash TEXT, status TEXT NOT NULL CHECK(status IN ('verified','invalid','unknown')),
  verified_by TEXT, verified_at TEXT, created_by TEXT NOT NULL, version_number INTEGER NOT NULL CHECK(version_number > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_evidence_cost_evidence_scope ON evidence_cost_evidence(session_id, room_id, discussion_id, created_at, id);
CREATE TABLE evidence_cost_evidence_events (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, room_id TEXT NOT NULL, discussion_id TEXT NOT NULL,
  op_id TEXT NOT NULL UNIQUE, target_id TEXT NOT NULL, operation TEXT NOT NULL, actor_id TEXT NOT NULL,
  request_json TEXT NOT NULL, record_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE evidence_cost_events (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, room_id TEXT NOT NULL, discussion_id TEXT NOT NULL,
  op_id TEXT NOT NULL UNIQUE, actor_id TEXT NOT NULL, task_id TEXT, agent_id TEXT, dispatch_id TEXT, tokens INTEGER, amount REAL,
  currency TEXT, latency_ms INTEGER, status TEXT NOT NULL CHECK(status IN ('estimated','recorded','failed','unknown')),
  source TEXT, request_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_evidence_cost_events_scope ON evidence_cost_events(session_id, room_id, discussion_id, created_at, id);
CREATE TABLE evidence_cost_budgets (
  session_id TEXT NOT NULL, room_id TEXT NOT NULL, discussion_id TEXT NOT NULL, tokens INTEGER, amount REAL,
  currency TEXT, version INTEGER NOT NULL CHECK(version > 0), last_op_id TEXT, last_request_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(session_id, room_id, discussion_id)
);
