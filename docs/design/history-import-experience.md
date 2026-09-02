# 会话历史导入体验设计

> 状态: 已落地 | 最后核对: 2026-09-01

## 目标

重新组织桌面端 Claude Code / Codex / ZCode 会话导入流程，使大量历史会话可以高效检索、批量选择，并在导入前完整阅读内容。

## ZCode 来源与 rewind 分支（2026-09 新增）

ZCode CLI 的会话存于中央 SQLite（`~/.zcode/cli/db/db.sqlite`，session/message/part 三级表），与文件型来源共用同一套 scan / preview / import 管线，差异点：

- **数据访问**：`zcodeStore.ts` 以只读方式打开（readonly + busy_timeout，WAL 并发读不锁库）；所有条目共享同一 db 路径，preview 请求必须携带 `sourceSessionId` 定位会话；schema 演进时仅置本来源不可用，不影响其他来源。
- **只导主线程**：`task_type='subagent_child'` 的子代理会话不导入（对齐 Claude Code 跳过 sidechain 的策略）。
- **rewind 分支条目**：含回退记录（`session.revert`）的会话在扫描时额外生成「（回退分支）」独立条目——`branchOf` 指回主线路、去重键为 `sessId#branch-n`、UI 默认不勾选。切分规则依赖 `message.sequence` 单调追加语义：主线路 = kept 前缀 + rewind 之后新消息；被回退段 = `[targetMessageID.sequence, 边界]` 连续区间（旧格式边界为 rewind 合成消息前一序号，新格式为 `branchCutAfterMessageID`）。多次 rewind 仅保留最后一次记录，按最后一次切分降级处理。
- **消息映射**：`semantics.kind='user_prompt'` → `user_message`（开 turn）；assistant 的 text/reasoning part → `assistant_message`/`agent_thinking`；tool part 状态机 → `tool_call` + `tool_result` 成对；合成消息（todo/system reminder、rewind 标记、压缩摘要）过滤。token 用量与现有两来源保持一致不映射。
- **续聊引擎**：SparkWork 无 zcode 执行器，导入会话回落用户默认 Provider（anthropic 型默认给 claude 内核，否则 codex 内核）。

## 信息架构

导入流程保留“扫描、选择、导入、完成”四个状态：

- 扫描状态并行读取 Claude Code、Codex 与 ZCode，本地展示每个来源的可用状态、发现数量和检索路径。
- 选择状态使用左侧虚拟列表承载大量会话，右侧为独立滚动的完整会话预览；选择键使用 `sourceSessionId`（ZCode 条目共享 db 路径，`filePath` 不唯一）。
- 工具栏提供来源、关键词、项目、时间和已导入状态筛选。
- 底部固定展示已选会话数、消息数、估算体积及导入主操作。
- 预览支持仅看用户消息和专注预览；默认加载足以覆盖常规会话的消息量，极长会话可继续加载完整内容。

## 主题策略

功能样式不维护独立的浅色或深色分支，全部继承应用级语义变量：

- 页面与浮层：`--panel`、`--panel-elev`、`--bg-soft`、`--bg-sunken`
- 文本：`--text`、`--text-strong`、`--text-muted`、`--text-faint`
- 边界：`--border`、`--border-strong`、`--divider`
- 品牌和状态：`--primary`、`--primary-soft`、`--success`、`--danger`

因此主题模式切换和自定义品牌主色会直接作用于导入界面，不需要组件内重复判断主题。

## 性能与可访问性

- 会话列表使用虚拟渲染，避免一次挂载数千个列表项。
- 列表行支持键盘 Enter / Space 打开预览，并提供可见焦点状态。
- 扫描、加载和导入过程使用 `aria-live` 或明确的进度反馈。
- 连续动画遵循 `prefers-reduced-motion`，减弱动画模式下保留静态状态表达。
- 消息正文不再使用行数截断，预览区域独立滚动并支持长文本换行。
