-- Project agent whitelist.
-- Each workspace can pin an explicit set of agents for chat/canvas pickers.
-- JSON array of agent ids; NULL or empty array = unbound (all enabled agents
-- shown, new sessions fall back to project default agent / global behavior).
-- The platform default assistant is always available regardless of whitelist.
-- No FK on purpose: agent ids live outside this database; dangling ids are
-- filtered out at read time.

ALTER TABLE workspaces ADD COLUMN allowed_agent_ids_json TEXT;
