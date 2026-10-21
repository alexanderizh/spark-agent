ALTER TABLE remote_agent_tasks
  ADD COLUMN last_event_seq INTEGER NOT NULL DEFAULT -1;
