-- 为 worktree 隔离会话记录其来源仓库 / 分支 / base 分支
ALTER TABLE workspaces ADD COLUMN worktree_meta_json TEXT;
