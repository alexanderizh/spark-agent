-- Migration 082: controls for overlapping and failed session scheduled turns.

ALTER TABLE scheduled_tasks
  ADD COLUMN skip_if_session_running INTEGER NOT NULL DEFAULT 1;

ALTER TABLE scheduled_tasks
  ADD COLUMN continue_on_error INTEGER NOT NULL DEFAULT 1;
