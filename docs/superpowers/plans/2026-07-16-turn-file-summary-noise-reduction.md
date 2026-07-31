# 会话文件变更汇总降噪方案

> 状态: 已落地 | 最后核对: 2026-07-31

## 目标

“本次修改完成”只展示归属于当前 turn 的高可信修改文件；多 Agent、多会话并发时不能把其他执行者的工作区变化算入本轮。Agent 通过 `present_files` 显式选择的成果文件继续走独立的交付文件卡片。

## 当前实现

- Edit / Write / Patch 等执行器直接产生的 `file_change` 形成实时 turn journal。
- Agent 在结束前调用 `spark_files.report_file_changes`，结构化提交本轮由自己或本轮派发成员实际创建、修改、删除或重命名的文件。
- Runtime 用工作区相对路径合并直接事件与 Agent manifest；同一文件只保留一次，并以 sessionId、turnId 和 team member context 维持归属。
- `present_files` 只负责用户应接收的交付文件，不与源码修改清单混用。
- 主列表不再通过全工作区 mtime 快照或 `git status` 猜测变更，因此不会吸收并发会话、外部编辑器或临时 Agent worktree 的变化。
- `.claude/worktrees`、`.worktrees`、`.spark/worktrees` 相对当前 workspace root 视为嵌套执行环境，Runtime 拒绝 manifest 上报；历史回放时 UI 也会清理旧采集逻辑产生的污染。若会话本身以某个 worktree 为 workspace root，其内部正常文件仍会保留。
- 旧事件中的 `workspace_snapshot`、`git_fallback` 来源继续兼容回放和启发式聚合，但不再产生新的全局兜底事件；checkpoint 只保留撤销元数据，不再把 `file_paths` 注入修改面板。

## 并发归属原则

文件是否属于本轮，必须来自执行事件或 Agent 的显式声明，而不是从共享工作区的最终状态反推。Git 只能描述“当前目录相对仓库基线的状态”，无法回答“哪个 session、哪个 turn、哪个成员改了它”；全局 mtime 快照同样无法区分并发写入者。因此二者都不能作为会话主列表的事实来源。

这种方案允许极少数未被执行器捕获、且 Agent 又遗漏 manifest 的 shell 副作用不出现在修改面板。相比把其他会话的数千个文件错误归因给当前 turn，这是更安全的失败模式；用户交付型媒体仍由 Runtime 的媒体 collector 和 `present_files` 独立兜底。

## 后续演进

1. 为 Bash / shell 执行器增加进程级写入审计，在平台支持时把变更直接关联到 toolCallId，进一步减少对 Agent manifest 的依赖。
2. 让更多生成器/MCP 返回结构化输出路径，Runtime 可自动追加到当前 turn journal。
3. 将 `present_files` 扩展为支持目录交付，适用于静态网站和打包产物。
