-- Migration 047: Add delivery semantics for team peer messages
--
-- delivery:
-- - NULL / 'call': existing behavior. Directed peer_message triggers the target immediately.
-- - 'note': targeted async note. It is written to the shared thread but does not trigger execution.

ALTER TABLE team_thread_messages
  ADD COLUMN delivery TEXT CHECK(delivery IN ('call','note'));

CREATE INDEX IF NOT EXISTS idx_team_thread_target_notes
  ON team_thread_messages(discussion_id, target_agent_id, delivery, created_at);
