CREATE TABLE task_graph_nodes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready','running','completed','failed','blocked','cancelled')),
  assignee_id TEXT,
  inputs_json TEXT NOT NULL,
  outputs_json TEXT NOT NULL,
  acceptance_status TEXT NOT NULL CHECK (acceptance_status IN ('pending','accepted','rejected')),
  retry_count INTEGER NOT NULL CHECK (retry_count >= 0),
  max_retries INTEGER NOT NULL CHECK (max_retries BETWEEN 0 AND 10),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_task_graph_nodes_scope
  ON task_graph_nodes(session_id, room_id, discussion_id, created_at, id);

CREATE TABLE task_graph_edges (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('dependency','parallel')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  UNIQUE(session_id, room_id, discussion_id, from_node_id, to_node_id, type)
);

CREATE INDEX idx_task_graph_edges_scope
  ON task_graph_edges(session_id, room_id, discussion_id, created_at, id);

CREATE TABLE task_graph_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  discussion_id TEXT NOT NULL,
  op_id TEXT NOT NULL UNIQUE,
  target_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN ('agent','system','user')),
  record_json TEXT NOT NULL,
  request_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_task_graph_events_scope
  ON task_graph_events(session_id, room_id, discussion_id, created_at, id);
