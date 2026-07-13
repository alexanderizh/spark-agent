-- Persist session-level counters so listing sessions never scans agent_events.

ALTER TABLE sessions ADD COLUMN turn_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN logical_message_count INTEGER NOT NULL DEFAULT 0;

UPDATE sessions
SET turn_count = (
      SELECT COUNT(*)
      FROM agent_events
      WHERE agent_events.session_id = sessions.id
        AND agent_events.event_type = 'user_message'
    ),
    logical_message_count = (
      SELECT COUNT(*)
      FROM agent_events
      WHERE agent_events.session_id = sessions.id
        AND (
          agent_events.event_type = 'user_message'
          OR (
            agent_events.event_type = 'assistant_message'
            AND (agent_events.event_mode IS NULL OR agent_events.event_mode = 'complete')
          )
        )
    );

CREATE TRIGGER agent_events_session_counters_insert
AFTER INSERT ON agent_events
WHEN NEW.event_type = 'user_message'
  OR (
    NEW.event_type = 'assistant_message'
    AND (NEW.event_mode IS NULL OR NEW.event_mode = 'complete')
  )
BEGIN
  UPDATE sessions
  SET turn_count = turn_count + CASE WHEN NEW.event_type = 'user_message' THEN 1 ELSE 0 END,
      logical_message_count = logical_message_count + 1
  WHERE id = NEW.session_id;
END;

CREATE TRIGGER agent_events_session_counters_delete
AFTER DELETE ON agent_events
WHEN OLD.event_type = 'user_message'
  OR (
    OLD.event_type = 'assistant_message'
    AND (OLD.event_mode IS NULL OR OLD.event_mode = 'complete')
  )
BEGIN
  UPDATE sessions
  SET turn_count = MAX(0, turn_count - CASE WHEN OLD.event_type = 'user_message' THEN 1 ELSE 0 END),
      logical_message_count = MAX(0, logical_message_count - 1)
  WHERE id = OLD.session_id;
END;
