# Codex Dual Core Adapter

> 状态: 实施中 | 最后核对: 2026-07-02

## 目标

Spark Agent 的 Codex 能力分为两条执行路径:

- Codex CLI: 使用宿主机本地 `codex` 命令执行，适合用户已经在本机登录并配置好的 Codex 环境。
- Codex SDK: 使用 `@openai/codex-sdk` 执行，读取 Spark 中配置的模型、API Key、Base URL、权限、MCP、技能和提示词上下文。

两条路径都必须输出 Spark 统一的 `AgentEvent`，让主时间线能展示思考、正文、工具调用、MCP 调用、终端输出、文件变更、用量和错误。

## 当前路由

运行时 adapter 选择为 `codex` 时，`SessionService` 会根据提供商配置决定执行器:

- `useLocalConfig === true`: 走 `CodexCliExecutor`，调用宿主机本地 CLI。
- 其他 Codex 提供商: 走 `CodexSdkExecutor`，使用 Spark 提供商里配置的模型和 OpenAI 兼容 API 参数。

这意味着设置页完整性检查中的 Codex SDK 不再是占位项。完整性页检查的是真实 npm 包 `@openai/codex-sdk`，而不是普通 `openai` SDK。

## Codex SDK 事件适配

`CodexSdkExecutor` 使用 `Codex.startThread()` 或 `Codex.resumeThread()` 创建线程，并通过 `Thread.runStreamed()` 消费官方 SDK 的流式事件。

已映射的事件:

- `agent_message`: 映射为 `assistant_message` 增量和最终完成事件。
- `reasoning`: 映射为 `agent_thinking`，用于展示 Codex 思考摘要。
- `command_execution`: 映射为 `tool_call`、`terminal_output`、`tool_result`。
- `mcp_tool_call`: 映射为 MCP 来源的 `tool_call` 和 `tool_result`。
- `file_change`: 映射为 Spark 文件变更事件。
- `web_search`: 映射为内置工具调用结果。
- `todo_list`: 映射为计划/待办工具调用结果。
- `turn.completed`: 映射为 usage 更新。
- `turn.failed` 和 `error`: 映射为 agent 错误事件。

## Codex CLI 事件适配

`CodexCliExecutor` 读取 `codex exec --json` 的 JSONL 事件流，并尽量向 `CodexSdkExecutor` 的事件语义看齐:

- `thread.started`、`turn.started` 仅作为内部状态推进，不再落到前端思考区，避免出现 `Codex CLI thread started` 这类噪声标题。
- `agent_message` / `message` / `assistant_message` 继续按累计文本切分成 `assistant_message` 增量。
- `reasoning` / `agent_reasoning` 与 `response.reasoning_*` delta 映射为 `agent_thinking`。
- `command_execution` 映射为 `tool_call(bash)`、`terminal_output`、`tool_result`，从而在时间线中展示命令、输出和退出状态。
- `tool_call`、`mcp_tool_call`、`web_search` 尽量映射为结构化 `tool_call` / `tool_result`，优先展示工具名、参数和结果，而不是退回到进度摘要。

## 上下文适配

Codex SDK 路径复用 Spark 现有会话上下文:

- 多层 system prompt、agent prompt、project prompt、session prompt。
- 技能 catalog 和选中技能 prompt。
- MCP server 配置。
- 附件中的图片输入。
- 会话目标 prompt。
- 工作区路径、额外目录、权限模式和 reasoning effort。

MCP 配置会转成 Codex config 中的 `mcp_servers`。stdio、sse、http 配置会尽量按 Codex 可识别的字段透传。

## 已知后续工作

- Codex CLI 的 JSONL 事件已经覆盖常见工具、终端输出和思考流，但仍需持续跟踪上游 schema 变化与新增 item 类型。
- 流式输出目前仍依赖主事件持久化链路，后续应对高频 delta 做批处理或节流，减少 UI 卡顿。
- 插件和技能已通过 prompt/catalog 注入适配到 Codex SDK，但还需要把 Codex 原生插件/技能能力与 Spark 技能商店做更深的状态联动。
- Codex SDK 依赖 `@openai/codex-sdk`，该包内部会携带并启动 `@openai/codex` CLI。版本升级需要同时关注 npm 供应链延迟策略和 CLI 事件 schema 变化。
