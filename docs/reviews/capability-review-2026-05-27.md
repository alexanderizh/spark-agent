# Spark Agent 全能 Code Agent 能力评审报告

日期: 2026-05-27  
评审对象: Spark Agent 当前代码库  
更新: 2026-05-27 夜间，结合本轮核心 code agent 开发提交重新校准

## 总体评估

当前总评: 75/100。

相较最初评审，项目已经从“骨架完整、执行内核薄弱”推进到“Claude SDK 主路径基本成型，核心上下文与项目配置开始进入运行时”的阶段。最关键的产品取舍已经落实: Claude 通道不再回退 direct Anthropic API，Claude Agent SDK 成为强制依赖；SDK 不可用时任务应失败并引导用户安装或修复 SDK。

当前仍不应扩展 Workflow、Multi-Agent、复杂团队协作等外层功能。下一阶段继续围绕“一个可靠的 code agent 能否完成真实项目修改”推进。

## 已完成的关键进展

### 1. Claude SDK 强制主路径

已完成:
- `claude` / `claude-sdk` 会话都走 Claude Agent SDK 执行路径。
- SDK 缺失或不可加载时写入 `SDK_REQUIRED` 错误事件，不再回退 direct Anthropic API。
- Settings 中明确 Claude Agent SDK 为必需组件。
- SDK 安装不再作为 optional dependency 处理。
- SDK executor 会产生 Spark 事件流，并补充 `context_usage` 事件。
- SDK `user(tool_result)` 消息已接入 Spark 事件流，避免工具结果在 UI 中丢失。
- SDK Edit/Write/MultiEdit 成功结果会产生 `file_change` 事件，ProjectView/ChatView 可感知文件变更。
- 已新增 `checkpoint` 事件和 UI block 承载，SDK result 若带 checkpoint metadata 可在消息流中展示。

当前判断:
- 核心策略已完成。
- SDK 工具调用、基础文件变更、usage、checkpoint 承载已补齐一层最小闭环。
- SDK 权限审批持久化已进入可用闭环；仍需继续补强 checkpoint diff 细节、真实任务下的 rollback/accept/reject 产品化。

### 2. 上下文额度与模型能力

已完成:
- `ModelCapabilityRegistry` 支持 provider 前缀和模型族推断。
- 已补充 GPT-5、GPT-5 Codex、GPT-4.1、Gemini 2.5 Pro、Claude 4.x 等上下文窗口信息。
- 未知模型默认按 128k 处理，不再让 UI 表现为“上下文额度未知/0”。
- Claude SDK 路径也会发出 `context_usage`。
- ChatView context meter 使用本轮估算上下文，而不是累计输入 token。
- 新增 `resolveModelContextWindow` / `resolveSoftContextLimit` 共享解析入口，direct loop、Claude SDK executor、ChatView 共用同一套模型窗口与软上限推断。
- Chat Inspector 的上下文窗口可视化优先使用最新 `context_usage`，避免把历史累计 input tokens 当作当前模型上下文占用。
- 修正 context meter 危险阈值判断顺序，95% 以上会进入 danger 状态。

当前判断:
- “几句话就显示上下文满”的主要显示层问题已修正；SDK 路径不再因为本地 fallback 只有 128k 而低估 Claude 模型窗口。
- 还没有完成真正的 Context Governor: 尚缺 token budget planner、pin/exclude、长会话摘要、项目上下文裁剪策略和可视化 ledger。

### 3. 对话任务队列 UI

已完成:
- Composer 中显示当前正在执行的用户任务。
- 用户连续发送的后续消息以队列形式展示。
- 队列入口显示“执行中 + 排队中”的总数。
- 新增 `session:get-queue` / `session:cancel-queued-turn` IPC 和 `stream:session:queue-changed` 推送，前端队列面板已改为后端 `pendingTurns` 快照驱动。
- 后端 queued turn 保留 `turnId`、message、`enqueuedAt`，支持取消单条排队消息。

当前判断:
- 基础体验已接近 Codex 风格，且不再只依赖前端本地临时队列。
- 仍需补强: 队列 reorder / promote、跨窗口并发体验、队列事件持久化审计。

### 4. 项目级规则、skills、agents 读取

已完成:
- 新增 `ProjectContextService`。
- 自动读取项目标准规则文件并注入运行时:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `GEMINI.md`
  - `.rules`
  - `.cursorrules`
  - `.windsurfrules`
  - `.clinerules`
  - `.github/copilot-instructions.md`
  - `.claude/AGENTS.md`
  - `.claude/CLAUDE.md`
  - `.codex/AGENTS.md`
  - `.agents/AGENTS.md`
  - `.claude/rules`
  - `.codex/rules`
  - `.agents/rules`
  - `.cursor/rules`
  - `.windsurf/rules`
- 自动读取项目内 skills:
  - `.claude/skills`
  - `.codex/skills`
  - `.agents/skills`
  - `skills`
- 自动读取项目内 agents:
  - `.claude/agents`
  - `.codex/agents`
  - `.agents/agents`
- 项目文件上下文会拼入 SDK/direct runtime prompt。
- DB 中的 project rules 已按当前 workspace 过滤。

当前判断:
- 读取、应用、审查主路径已完成。
- UI 已通过 `project_context_loaded` 事件和 Chat Inspector 暴露“本轮加载了哪些项目规则/skills/agents”。
- 当前实现是只读扫描，不会把项目内 skills/agents 自动导入 DB；这是有意保持可控。后续可增加“发现并导入/固定到项目配置”的操作。

### 5. 权限审批规则持久化

已完成:
- permission profile/rule/session permission mode 已有 DB 持久化。
- 会话的 permission mode 会随 session runtime 配置保存。
- Settings 已有权限规则和 SDK 健康检查相关 UI 基础。
- `permission_decisions` 已支持 project/global 级 allow/deny 记忆。
- `PermissionService` active profile 已 DB-backed，不再依赖进程内静态状态。
- SDK permission callback 会携带 action、project/workspace scope，先命中持久化决策，再弹出审批。
- ChatView inline approval 已提供 allow once、allow session、allow/deny project、allow/deny global 等操作。

仍需补强:
- 尚未提供审批记录的审计视图。

当前判断:
- “权限模式、规则配置、会话审批决策持久化”已基本具备。
- 后续重点转为 Settings 审计视图、最近命中时间、规则来源解释和批量管理。

### 6. 结构化用户补充问答

当前状态:
- 尚未实现类似 Claude 的通用 clarification request。
- agent 不确定时目前只能通过普通 assistant 文本追问用户；用户回复会作为后续 turn 进入，而不是结构化暂停/恢复同一任务。
- 已有的用户交互能力主要是工具权限审批和 plan approval，它们都不是通用问答模块。

建议目标:
- 新增结构化用户补充问答能力，让 agent 可以在信息不足时向用户请求单选、多选或自由文本补充。
- 该能力应区别于 permission approval: 它用于补足任务语义，而不是授权工具执行。
- 如果 Claude Agent SDK 没有直接暴露通用 human input hook，可评估通过 Spark 侧 MCP/tool bridge 提供 `ask_user` 工具实现。

## 当前提交进度

已完成提交:

- `b27f9d5 feat: require Claude SDK execution`
- `dea5b62 feat: mark Claude SDK required in settings`
- `2ce3ca5 fix: correct context budget and task queue display`
- `6388338 feat: load project context into agent runtime`
- `6665f8d fix: refresh workspace sessions after project creation`
- `e42db8e docs: update code agent roadmap after core progress`
- `232a2e1 feat: surface SDK tool results and checkpoints`
- `19455ee feat: persist permission approval decisions`
- `522de69 feat: expose project context sources`
- `b67941c fix: harmonize context window reporting`
- 本次变更: backend queue sync，补 `pendingTurns` IPC 快照、queue changed stream、ChatView 后端队列渲染与单条取消。

最近验证:

- `pnpm -r run typecheck`
- `pnpm --filter @spark/shared test:unit -- src/model-capabilities.test.ts`
- `pnpm --filter @spark/agent-runtime test:unit -- src/services/project-context.service.test.ts src/__tests__/services/session.service.test.ts`
- `pnpm --filter @spark/desktop typecheck`
- `pnpm --filter @spark/desktop test:unit -- src/renderer/tests/renderer.test.ts`
- `pnpm --filter @spark/protocol typecheck`
- `pnpm --filter @spark/storage typecheck`
- `pnpm --filter @spark/agent-runtime test:unit -- src/__tests__/services/permission.service.test.ts`
- `pnpm --filter @spark/agent-runtime typecheck`
- `pnpm --filter @spark/shared typecheck`
- `pnpm --filter @spark/agent-runtime test:unit -- src/__tests__/core/agent-loop-new.test.ts`
- `pnpm --filter @spark/agent-runtime test:unit -- src/__tests__/services/session.service.test.ts`
- storage repository test note: `pnpm --filter @spark/storage test:unit -- src/repositories/repositories.test.ts` is currently blocked by local `better-sqlite3` Node ABI mismatch (module 125 vs required 137), before reaching the new SQL logic.

说明: renderer 测试仍会输出既有 React `act(...)` 警告，但测试通过。

## 下一步开发建议

### P0-A: 权限审批决策持久化闭环

目标:
- 把 SDK permission callback 与 Spark 权限系统完全打通。
- 用户审批时可以选择:
  - 仅本次允许
  - 本会话允许
  - 本项目允许
  - 始终允许
  - 拒绝并记住
- 持久化规则需要能回显、编辑、禁用和删除。

开发内容:
- 扩展 permission approval payload，带上 tool name、input 摘要、workspaceId、sessionId、suggested scope。
- 新增 approval decision repository 或复用 permission rule repository。
- ChatView approval UI 增加持久化选项。
- Settings 权限页增加来源、作用域、最近命中时间。
- SDK permission mapper 根据持久规则自动决定 allow/deny/ask。

验收标准:
- 同一项目内重复触发相同安全级别工具时，可按用户选择自动放行或拒绝。
- 删除/禁用规则后立即恢复询问。

### P0-B: 后端任务队列状态与前端同步

目标:
- 不只在 Composer 本地维护 queuedMessages，而是以后端 session queue 为准。

开发内容:
- SessionService 暴露 active turn 与 pending turns 状态。
- 新增 IPC: `session:queue:get` 或并入 session summary。
- `sendTurn(started:false)` 返回 queue position。
- ChatView 队列面板显示后端真实队列，支持取消单个 queued turn。

验收标准:
- 连续发送多条消息、刷新 UI、切换 session 后，队列仍准确显示。
- cancel turn 会清理 running + pending，并同步 UI。

### P0-C: 项目上下文来源可审查

目标:
- 用户能知道本轮 agent 到底加载了哪些 `.claude`、`.rules`、skills、agents。

开发内容:
- 在 runtime context 中保留 `ProjectContextService.sources`。
- 通过 agent event 或 session inspector 展示来源列表。
- Chat Inspector 增加“项目上下文”区域。
- 对超长项目文件显示截断提示。

验收标准:
- 发送消息前或执行中，用户可以看到本轮使用的项目规则、skills、agents。
- 规则文件内容过大时有明确截断标识。

### P1-A: Context Governor MVP

目标:
- 从“显示上下文额度”升级到“主动管理上下文额度”。

开发内容:
- context modes: minimal、project-smart、deep-research、review、manual。
- 文件 pin/exclude。
- Context Ledger: system prompt、project files、skills、history、tool results 分项 token 估算。
- 长会话摘要策略。
- 超预算时优先裁剪低价值来源，而不是等模型失败。

验收标准:
- 200k 模型下能稳定处理长会话，不会几轮后不可继续。
- UI 能解释上下文消耗来自哪里。

### P1-B: SDK checkpoint / diff 审查产品化

目标:
- 利用 Claude SDK 的 checkpoint/change 信息，让用户可审查、可恢复。

开发内容:
- 捕获 SDK checkpoint metadata。
- Chat 中展示变更摘要。
- Project/Inspector 中展示文件 diff。
- 后续接入 accept/reject/rollback。

验收标准:
- agent 修改文件后，用户能在 UI 中看到变更文件、diff 摘要和 checkpoint 关系。

### P1-C: 自修复开发循环

目标:
- agent 完成代码修改后自动建议或执行本项目合适的验证命令。

开发内容:
- 识别 package manager 和 workspace scripts。
- 根据改动范围推荐 typecheck/test。
- 失败摘要回灌给 agent 继续修复。

验收标准:
- TypeScript/单测失败时能自动进入修复循环，直到通过或明确停止。

### P1-D: 结构化用户补充问答

目标:
- 当 agent 对任务意图、约束或偏好不确定时，可以暂停执行并向用户提出结构化问题。

开发内容:
- 协议层新增通用 `user_input_request` / `user_input_response` 事件或等价 IPC。
- 支持单选、多选、确认型问题和自由文本输入。
- ChatView 在 composer 附近渲染问答卡片，回答后将结果回传运行时。
- 评估 Claude Agent SDK 路径是否可原生暂停/恢复；如不可行，优先通过 Spark MCP/tool bridge 暴露 `ask_user` 工具。

验收标准:
- agent 可以在同一任务链路中提出补充问题，用户回答后继续执行。
- 问答记录进入 session history，后续上下文可追踪用户选择和补充文本。

## 暂缓事项

以下内容不建议立即投入:

- Multi-Agent 编排
- Workflow DAG 执行引擎
- Monaco Editor 深度集成
- PTY 终端
- 虚拟列表大改
- 复杂插件市场

原因:
- 当前最重要的是让单个 code agent 的“读项目配置 -> 执行任务 -> 审批工具 -> 修改代码 -> 展示队列/上下文 -> 验证结果”闭环可靠。

## 推荐下一轮切入顺序

1. 权限审批决策持久化闭环。
2. 后端任务队列状态同步到 UI。
3. 项目上下文来源审查 UI。
4. Context Governor MVP。
5. SDK checkpoint / diff 审查。
6. 自修复验证循环。
7. 结构化用户补充问答。

若只选一个下一步，应优先做“权限审批决策持久化闭环”。这是 SDK code agent 能否长期可用、可控、可被用户信任的关键。
