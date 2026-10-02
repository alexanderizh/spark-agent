-- Project default agent.
-- Each workspace can pin a default agent so new sessions created inside the
-- project bind to it instead of falling back to the global "last used" agent.
-- NULL keeps the previous behavior (global prefs → global default agent).
-- No FK on purpose: agent ids live outside this database (managed agents are
-- platform-level); a dangling id is treated as unset at read time.

ALTER TABLE workspaces ADD COLUMN default_agent_id TEXT;
