-- 036_canvas_project_cover_url.sql
-- 无限画布项目支持封面图：cover_url 存封面图的 safe-file:// URL（指向项目目录内的文件）。
-- 与 cover_asset_id 区分：
--   - cover_asset_id 语义为「canvas_assets 表中某条 asset 的 id 引用」（用于资产血缘场景）
--   - cover_url 是「项目级展示用封面图」的访问 URL，独立于画布内容，即使画布为空也可单独存在
-- 列表查询直接 SELECT 出来供前端使用，无需 JOIN。

ALTER TABLE canvas_projects ADD COLUMN cover_url TEXT;
