-- 031_canvas_project_root_path.sql
-- Give each infinite-canvas project an optional filesystem root.
-- SQLite remains the list/index store; the project directory becomes the
-- resource container and backup-friendly fact source.

ALTER TABLE canvas_projects ADD COLUMN root_path TEXT;

CREATE INDEX IF NOT EXISTS idx_canvas_projects_root_path
  ON canvas_projects (root_path);
