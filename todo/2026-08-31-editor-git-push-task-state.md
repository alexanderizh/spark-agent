# 内置编辑器首次推送本地分支任务状态

目标：让内置编辑器 Git 操作支持新建本地分支的首次推送，远端目标分支与本地分支同名，并与现有悬浮 Git 面板共用一致行为。

当前进度：

- 已确认内置编辑器底部“同步”固定先执行 pull；新本地分支没有 upstream 时 pull 失败，后续 push 不会执行。
- 已确认主进程首次 push helper 固定使用 `origin`，且缺少远端时错误不够明确。
- 已完成代码：统一首次 push 的远端选择与同步分支判断，并新增 `workspace:git-sync` IPC。
- 已完成回归测试、类型检查、定向 lint/格式检查、源码审查与最终变更范围核对。

关键决策：

- 有 upstream 的分支继续使用 Git 默认 `push`。
- 无 upstream 的分支选择 Git push 默认远端（`branch.<name>.pushRemote` → `remote.pushDefault` → `branch.<name>.remote` → `origin` → 首个远端），执行 `git push -u <remote> <currentBranch>`。
- 内置编辑器同步在无 upstream 的本地分支上直接执行首次 push，不先执行无法完成的 pull；有 upstream 时保持先拉后推。
