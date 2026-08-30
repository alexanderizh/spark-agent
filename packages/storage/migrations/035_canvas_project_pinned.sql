-- 035_canvas_project_pinned.sql
-- 支持无限画布项目置顶：pinned=1 表示置顶，pinned_at 记录置顶时间用于置顶内排序。
-- 列表查询时 ORDER BY pinned DESC, datetime(pinned_at) DESC, datetime(last_opened_at) DESC，
-- 保证置顶项目优先展示，置顶内部按最近置顶时间排序，未置顶按最近打开时间排序。

ALTER TABLE canvas_projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canvas_projects ADD COLUMN pinned_at TEXT;

CREATE INDEX IF NOT EXISTS idx_canvas_projects_pinned
  ON canvas_projects (user_id, pinned, pinned_at);
