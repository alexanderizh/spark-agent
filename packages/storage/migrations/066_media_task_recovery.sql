-- Durable media task recovery metadata.
ALTER TABLE media_generation_tasks ADD COLUMN provider_task_id TEXT;
ALTER TABLE media_generation_tasks ADD COLUMN project_id TEXT;
ALTER TABLE media_generation_tasks ADD COLUMN client_task_id TEXT;
ALTER TABLE media_generation_tasks ADD COLUMN polling_json TEXT;
ALTER TABLE media_generation_tasks ADD COLUMN submit_response_json TEXT;

UPDATE media_generation_tasks
SET provider_task_id = request_id
WHERE provider_task_id IS NULL AND request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_generation_tasks_provider_task
  ON media_generation_tasks (provider_profile_id, provider_task_id);
CREATE INDEX IF NOT EXISTS idx_media_generation_tasks_canvas_owner
  ON media_generation_tasks (project_id, client_task_id);
