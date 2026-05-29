# Spark Agent 全能 Code Agent 能力评审报告

日期: 2026-05-27  
评审对象: Spark Agent 当前代码库  
更新: 2026-05-28，补充 05-27~05-28 两天提交中的新进展：slash 命令系统重构、会话恢复、config panel 重构、skills 管理增强、代码清理与 SDK 加固。

追加更新: 2026-05-28 晚间补齐 Plan mode / SDK_ERROR 稳定性修复。

- 临时关闭 Claude SDK resume。原因是当前桌面端复现出“新会话第一轮成功、第二轮 `Claude Code process exited with code 1`”以及旧会话 fresh turn 报 `Session ID ... is already in use` 的行为。当前在 resume 关闭时为每个 fresh turn 生成唯一 SDK session id，多轮连续性暂时由 Spark 持久化历史上下文注入保障。
- 放行 `ExitPlanMode` / `exit_plan_mode` / `EnterPlanMode` / `enter_plan_mode` / `AskUserQuestion` / `ask_user_question` 等控制工具别名，避免 Plan mode 同时出现中央计划审批和底部工具权限审批。
- Composer 侧同步增加控制工具审批抑制，即使控制工具 approval request 被异常透传，也不会渲染底部 inline approval card；计划审批只走中央 `PlanApprovalModal`。
- Composer 工作中状态改为只依赖 session `running` 状态，避免错误或停止后的残留状态让后续发送被当成“停止生成”。
- Composer 现在按当前 provider 校验会话/草稿 model，旧会话没有 `modelId` 时只使用该 provider 的默认模型，不再把全局草稿模型串到旧会话；同一 SDK adapter 内切换 provider/model 时会原子持久化 `providerProfileId`、`modelId`、`agentAdapter` 和 `permissionMode`，避免把小米模型发到腾讯云 endpoint 这类错配。
- SessionService 增加运行时配置回归，证明旧会话发送、同 SDK adapter 切 provider/model 后下一轮发送、以及 `session:send-turn` runtime patch 都会解析到一致的 provider endpoint、model、permission 和独立 SDK session id。
- 下一步计划需把 SDK resume 做成带健康检测/回退的能力，而不是默认启用。

本次复盘后的下一步开发计划:

1. **P0 稳定性回归**: 增加 Plan mode 端到端测试，覆盖“产出计划 -> 只出现一个计划审批入口 -> 批准后继续执行 -> 再发送一轮消息不触发 SDK_ERROR”。
2. **P0 provider/model 一致性回归**: 覆盖旧会话回显、旧会话发送、新建会话继承草稿偏好、同 adapter provider/model 切换、跨 adapter 切换等路径，确保 UI、session runtime patch、SDK query options 三处一致。
3. **P0 SDK resume 安全恢复**: 为 Claude SDK resume 增加 capability flag、失败熔断、自动回退到 fresh session，以及明确的错误 telemetry；确认稳定后再逐步开启。
4. **P0 权限 UI 去重**: 把工具权限审批、计划审批、结构化用户问答三类交互建立统一队列/优先级，保证同一 turn 不会同时渲染多个互相冲突的审批入口。
5. **P1 结构化用户问答**: 复用 `AskUserQuestion` 控制工具，补齐协议事件和 composer 附近的回答卡片，把“等待用户补充”从普通文本追问升级为可恢复状态。
6. **P1 评审与恢复链路**: 继续完善 checkpoint diff 的文件级 accept/reject、失败恢复提示，以及验证失败后的 retry trail UI。

## 总体评估

当前总评: 81/100。

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
- SDK 权限审批持久化已进入可用闭环；checkpoint diff 摘要已进入 Chat Inspector / Project agent pane，checkpoint rollback 已有 slash command 与 UI 入口；仍需继续补强 accept/reject 的真实文件级产品化。

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
- 2026-05-28 补齐 Session SDK 权限策略第一阶段:
  - Claude SDK 原生工具名已归一化为 Spark action，`Read/Edit/Bash/WebSearch/mcp__*` 不再误落到默认 command 策略。
  - `claude-auto` / `claude-bypass` 不再挂 Spark `canUseTool`，优先保留 SDK 自带权限策略。
  - `claude-auto-edits` 保持 SDK `acceptEdits` 语义，编辑类工具自动允许，命令仍进入审批。
  - 危险 Bash 命令升级为 `command_dangerous`，`ask-twice` 现在是真正的双重确认。
  - Composer 权限下拉对 Auto 和 Bypass 做风险态联动，Bypass 使用危险色常驻提示。
  - Settings 权限策略页已同步 SDK 执行默认策略，写入 SQLite-backed `app_settings(runtime-permissions/defaults)`，并和 Composer 快速缓存保持同步。
  - `session:create` 在 adapter / permissionMode 缺省时会读取持久化默认策略，不再被 schema 默认值固定到 `codex-default`。

仍需补强:
- 尚未提供审批记录的审计视图。
- workspace/path/network whitelist/server scope 仍未全部执行到策略判定中，需要下一阶段补齐。

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

### 7. Slash 命令系统重构

已完成:
- 三层命令架构（系统命令 / 插件命令 / Agent 转发命令）落地。
- 输入框 `/` 触发 slash command 弹窗，支持键盘导航和树形分组。
- 命令结果以 Agent 消息模式展示在聊天流中。
- 命令弹窗主题适配 + forwardToAgent 透传。
- 清理 28 个未实现命令，保留功能可用的命令集合。
- 新增 git agent-forwarding 子命令（`/git diff`、`/git log` 等）。
- 修复 slash command popup index 不一致问题（使用 flatSlashList 作为唯一数据源）。
- 修复空命令列表时 Enter 被拦截导致发送失败的问题。

当前判断:
- 命令系统从 6 个命令扩展到完整的三层架构，可维护性和扩展性显著提升。
- 后续可继续丰富各层命令，尤其是 agent-forwarding 层支持更多 `/git` 子命令和 `/workspace` 操作。

### 8. 会话恢复与历史增强

已完成:
- 新增 session recovery 机制，应用重启后可恢复上次的活跃会话。
- 会话历史分页加载，支持 `beforeSeq` 参数按序号分页。
- 权限审批支持 `forcePrompt`，可在特定上下文强制弹出审批。
- 消息删除能力（可删除单条消息）。
- Plan mode 事件和扩展 SDK permission types 集成。

当前判断:
- 会话持久化和恢复能力已接近产品级。
- 仍需补强：会话摘要自动生成、跨会话上下文延续。

### 9. Config Panel 重构与 Skills 管理

已完成:
- Config panel 从 popup 重构为 side panel，与 inspector 互斥展示。
- Skills/Prompts/Tools 从 inspector 移至 config panel（通过 More 按钮入口）。
- Skills 管理页支持分页去重、固定卡片高度、多选批量删除。
- 技能去重改用名称过滤，本地候选显示来源路径，按来源分 tab 搜索。
- 新增 `deduplicateSkills` utility 和 local/remote skill helpers。
- Skill instructions 按需加载（Load on demand），减少初始化开销。
- 本地 Skill 检测后支持多选导入和单个导入。
- System Prompt 抽取为独立 settings section。
- Prompts 和 Tools sections 默认展开。

当前判断:
- Skills 管理和配置面板的用户体验已接近产品级。
- 已移除 legacy agent loop runtime 和 legacy skill lookup path，技术栈清理干净。

### 10. 代码清理与 SDK 集成加固

已完成:
- 移除 legacy agent loop runtime（`a8c7a82`）。
- 移除 legacy skill lookup path（`aceff35`）。
- Claude Code native executable 路径解析与 workspace 可用性验证（`c457bd7`）。
- SDK integrity check 扩展：主机工具检测（node/npm/git）。
- SDK detection 跨平台支持重写。
- Validation repair retries 增加 bound 限制。
- Chat header 新增 IDE 和 Terminal 打开按钮，支持自动检测。
- 会话内容区与底部输入区改为 flex 布局，解决重叠问题。
- Node.js 在 About 页显示为 unknown 的修复，以及 packaged Electron app 的 PATH 修复。
- Settings 导航侧栏垂直滚动支持。
- Composer 参数栏换行修复，选择器弹窗 z-index 修复。
- ESC 无 overlay 打开时避免不必要的 re-render。

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
- `094190a feat: sync queued turns from runtime`
- `8916c22 feat: add project context governor`
- `23c9644 feat: show checkpoint file context`
- 自修复开发循环 MVP: 验证命令建议、`/validate` 执行入口、Chat 验证卡片、基础结果回流、失败摘要回灌、retry attempt/max-retries 和停止条件。
- `a8c7a82 Remove legacy agent loop runtime`
- `aceff35 Remove legacy skill lookup path`
- `f9862d0 Load skill instructions on demand`
- `a826354 feat: 三层命令架构 + 消息删除能力`
- `008a1e2 feat: 输入框 / 触发 slash command 弹窗`
- `595d512 feat: add layered skills and prompts`
- `a2e3dad feat: 会话历史分页加载与权限审批 forcePrompt 支持`
- `87270c6 refactor: change config panel from popup to side panel, mutual exclusion with inspector`
- `dd55490 feat: move Skills/Prompts/Tools from inspector to config panel via More button`
- `c8011a1 feat: 技能管理页分页去重、固定卡片高度、多选批量删除`
- `a0ae433 fix: 技能去重改用名称过滤、本地候选显示来源路径、按来源分 tab 搜索`
- `a2a8bd2 feat: add session recovery, conversation history prompt, project-local skills, plan mode events, and expanded SDK permission types`
- `c457bd7 feat: resolve Claude Code native executable and validate workspace availability`
- `f26f926 refactor: clean up slash commands, remove 28 non-functional commands, add git agent-forwarding subcommands`
- `7ae449e fix: prevent unnecessary re-render when pressing ESC with no overlay open`
- `f80b08f feat(chat-header): add IDE and Terminal open buttons with auto-detection`
- `7152ee0 feat(settings): extract System Prompt into dedicated settings section`
- `f0ad3b0 fix: expand prompts and tools sections by default in config panel`

最近验证:

- `pnpm -r run typecheck`
- `pnpm --filter @spark/shared test:unit -- src/model-capabilities.test.ts`
- `pnpm --filter @spark/agent-runtime test:unit -- src/services/project-context.service.test.ts src/__tests__/services/session.service.test.ts`
- `pnpm --filter @spark/desktop typecheck`
- `pnpm --filter @spark/desktop test:unit -- src/renderer/tests/renderer.test.ts`
- `pnpm --filter @spark/agent-runtime typecheck`
- `pnpm --filter @spark/agent-runtime test:unit -- src/__tests__/core/command-registry.test.ts src/__tests__/services/session.service.test.ts`
- `pnpm --filter @spark/desktop typecheck`
- `pnpm --filter @spark/desktop test:unit -- src/renderer/tests/renderer.test.ts src/renderer/tests/event-mapper.test.ts`
- `pnpm --filter @spark/protocol typecheck`
- `pnpm --filter @spark/storage typecheck`
- `pnpm --filter @spark/agent-runtime test:unit -- src/__tests__/services/permission.service.test.ts`
- `pnpm --filter @spark/agent-runtime typecheck`
- `pnpm --filter @spark/shared typecheck`
- `pnpm --filter @spark/agent-runtime test:unit -- src/__tests__/core/agent-loop-new.test.ts`
- `pnpm --filter @spark/agent-runtime test:unit -- src/__tests__/services/session.service.test.ts`
- `pnpm --filter @spark/agent-runtime test:unit -- src/services/project-context.service.test.ts src/__tests__/services/session.service.test.ts`
- storage repository test note: `pnpm --filter @spark/storage test:unit -- src/repositories/repositories.test.ts` is currently blocked by local `better-sqlite3` Node ABI mismatch (module 125 vs required 137), before reaching the new SQL logic.

说明: renderer 测试仍会输出既有 React `act(...)` 警告，但测试通过。

## 下一步开发建议

### ~~P0-A: 权限审批决策持久化闭环~~ ✅ 已完成

权限审批决策持久化已基本完成（见第 5 节）。后续重点转为 Settings 审计视图和规则管理。

### ~~P0-B: 后端任务队列状态与前端同步~~ ✅ 已完成

后端任务队列已同步到 UI（`094190a`），支持 `session:get-queue` / `session:cancel-queued-turn` IPC。

### ~~P0-C: 项目上下文来源可审查~~ ✅ 已完成

项目上下文来源已通过 `project_context_loaded` 事件和 Chat Inspector 暴露（`8916c22`、`522de69`）。

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

已完成:
- `ProjectContextService` 支持 `minimal`、`project-smart`、`review`、`deep-research`、`manual` 模式的预算入口。
- `project-smart` 会按模型软上限的 25% 生成项目上下文预算，最高 60k tokens。
- 项目规则、agents、skills 会按预算进入 prompt；超预算来源会被裁剪或排除。
- `project_context_loaded` 事件携带 budget、included、estimatedTokens、truncated、reason。
- Chat Inspector 可展示项目上下文模式、预算用量、来源 token 估算和裁剪/排除原因。

仍需补强:
- context modes: minimal、project-smart、deep-research、review、manual。
- 文件 pin/exclude。
- Context Ledger: system prompt、project files、skills、history、tool results 分项 token 估算。
- 长会话摘要策略。
- history/tool results 的 Context Ledger 和长会话摘要仍未完成；当前 MVP 先管理项目上下文块。

验收标准:
- 200k 模型下能稳定处理长会话，不会几轮后不可继续。
- UI 已能解释项目上下文消耗来自哪里；history/tool results 分项解释仍需下一轮。

### P1-B: SDK checkpoint / diff 审查产品化

目标:
- 利用 Claude SDK 的 checkpoint/change 信息，让用户可审查、可恢复。

已完成:
- 捕获 SDK checkpoint metadata。
- Chat 中展示 checkpoint，并把 SDK 返回的相关文件列表直接显示在 checkpoint pill 内。
- Checkpoint 文件列表支持截断展示和 hover 完整文件列表。
- Chat Inspector 中新增 Change Review，按文件聚合 `file_change`，展示 changeType、+/- diff 摘要以及关联 checkpoint。
- Project agent pane 的 `file_change` block 会在存在 diff 时展示 +/- 行数，便于项目视图内快速审查。
- 新增 `/checkpoint list|restore <checkpoint-id>`，可从会话 checkpoint 事件中定位 SDK checkpoint metadata，并在存在 checkpoint path / filePaths 时安全恢复文件到 workspace。
- Chat checkpoint pill 增加 restore 入口，触发 `/checkpoint restore` 并将结果写回当前消息流。

仍需补强:
- 后续接入文件级 accept/reject，以及 richer diff / hunk preview。
- 真实 SDK 任务下继续扩展多文件 checkpoint 恢复结果的 UI 反馈和失败分项提示。

验收标准:
- agent 修改文件后，用户能在 UI 中看到变更文件、diff 摘要和 checkpoint 关系，并可从 checkpoint pill 触发 restore。

### P1-C: 自修复开发循环

目标:
- agent 完成代码修改后自动建议或执行本项目合适的验证命令。

已完成:
- 新增 `ValidationSuggestionService`，根据 workspace package manager、`package.json` scripts 和本轮 `file_change` 范围推荐 typecheck/test/lint。
- 新增 `validation_suggestion` agent event，direct loop 和 Claude SDK loop 在代码变更完成后都会发出验证建议。
- 新增 `/validate` 命令入口，只允许运行当前 workspace `package.json` 中匹配 typecheck/test/lint/check 的验证脚本，并把 stdout/stderr/exit code 回流到会话。
- ChatView 已渲染“建议验证”卡片，展示变更文件、推荐命令、推荐原因，并支持一键运行 `/validate`；ProjectView 也会显示验证摘要。
- ChatView 验证卡片已增加“修复”入口: `/validate "<command>" --repair` 在验证失败时生成失败摘要并交给 `SessionService` 自动发起下一轮 agent 修复 turn。
- `/validate --repair` 支持 `--attempt` / `--max-retries`，默认最多 3 次；达到上限时停止继续回灌。
- 命令结果 `data.validationRepair` 会记录 attempt、maxAttempts、nextAttempt、stopped、stopReason，形成可追踪的 retry trail 基础数据。

开发内容:
- 自动重试后的 UI retry trail 展示。
- agent 完成修复后自动复跑验证的编排触发。

验收标准:
- 当前 MVP 已能在代码变更后建议、运行验证，并在用户选择“修复”时把失败摘要回灌给 agent；repair 命令已有重试次数、停止条件和 retry trail 数据，后续需要把 trail 完整产品化并自动复跑验证。

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

~~1. 权限审批决策持久化闭环。~~ ✅ 已完成
~~2. 后端任务队列状态同步到 UI。~~ ✅ 已完成
~~3. 项目上下文来源审查 UI。~~ ✅ 已完成
4. Context Governor 继续补强（文件 pin/exclude、Context Ledger、长会话摘要）。
5. SDK checkpoint / diff 审查产品化（文件级 accept/reject、richer diff / hunk preview）。
6. ~~自修复验证循环。~~ ✅ MVP 已完成，继续补强 UI retry trail。
7. 结构化用户补充问答。

若只选一个下一步，应优先做”Context Governor 继续补强”。上下文管理是长会话可用性的核心瓶颈。
