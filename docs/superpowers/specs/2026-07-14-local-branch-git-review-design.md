# 本地新分支 Git 审查探测设计

> 状态: 已落地 | 最后核对: 2026-07-14

## 根因

`workspace:git-status` 只通过 `git status --porcelain` 收集未提交文件，并通过 `git diff HEAD` 统计行数。没有 upstream 的新本地分支不会计算相对远端默认分支的提交差异，`ahead` 也保持为零。Git 悬浮面板和右侧审查面板共用该状态，因此同时漏掉“已提交但未推送”的分支改动。

调查还确认通用 stdout helper 的 `.trim()` 会删除 porcelain 首行的前导空格，把仅工作区修改误判为已暂存；新状态模块对 porcelain 使用保留前导空格的读取方式。

## 目标行为

- 有 upstream 时，以 upstream 与 `HEAD` 的 merge-base 为审查基线。
- 没有 upstream 时，优先使用远端默认分支，随后尝试远端 `main` / `master`；都不存在时回退到 `HEAD`。
- 审查文件合并“基线到当前工作区”的跟踪文件差异与 untracked 文件，因此覆盖本地提交、暂存和未暂存内容。
- `ahead` / `behind` 相对选定比较分支计算；新分支未 push 时能够显示待推送提交数。
- `changedFiles`、`stagedFiles`、`unstagedFiles` 仍只表示待提交的工作区状态，避免提交对话框把已提交文件再次当作待提交文件。
- 已提交差异在审查 UI 中显示为“已提交”，并能加载相对比较基线的完整 diff。

## 结构

把超过 3000 行的 `main/ipc/index.ts` 中 Git 状态、diff、分支与推送辅助函数迁移到独立 `workspace-git-status.ts`。主 IPC 文件只保留 handler 调用。新模块负责比较基线选择、Git 输出解析、状态合并和文件 diff。

## 测试

使用真实临时 Git 仓库和 bare remote：创建并推送 `master`，新建本地 feature 分支并提交但不 push，验证状态能看到提交文件、`ahead=1`、远端比较分支为 `master`，同时待提交文件数仍为零；再验证文件 diff 能返回 feature 分支内容。
