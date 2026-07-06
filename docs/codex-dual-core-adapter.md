# Codex Dual Core Adapter

> 状态: 实施中 | 最后核对: 2026-07-06

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

## 自动路由卡

本地 CLI provider 仍然保留“跟随宿主机配置”的默认行为：当会话或 Agent 没有显式选择模型时，Claude CLI / Codex CLI 继续使用本机已有登录态、配置文件和默认模型。

CLI 模型切换是独立能力，当前未启用。本地 Claude CLI / Codex CLI 不消费应用内 SDK 模型卡，也不消费自动路由卡。

自动路由在模型选择层表现为两个内置虚拟 Provider:

- `Claude Auto Router` (`claude-auto-router`)
- `Codex Auto Router` (`codex-auto-router`)

当 `model_profiles` 中的模型卡 `configJson.kind` 为 `router` 时，它会被视为对应虚拟 Provider 下的自动路由模型，而不是实际调用 provider。会话、单 Agent、团队成员依旧保存 `providerProfileId + modelId + agentAdapter`；如果 `providerProfileId` 是自动路由虚拟 Provider，`SessionService` 会在创建 SDK executor 之前，把选中的路由模型卡解析成真实 provider profile 与 model id。

路由卡按接口格式拆分，避免 Claude 与 Codex 的鉴权、base URL 和模型协议互相污染:

- `adapter: "claude"` 只允许路由到 Anthropic 格式 provider，用于 Claude SDK / Claude CLI 兼容路径。
- `adapter: "codex"` 允许路由到 OpenAI 与 openai-compatible 文本 provider，包括聚合商文本模型。
- Codex 路由会排除 `image`、`voice`、`video`、带 `mediaProvider` 或 `mediaCapabilities` 的多媒体生成模型，避免把图片/语音/视频模型注入到文本对话执行链路。历史上用于“对话模型”的 `multimodal` 字面量不会单独排除。

路由配置保存在模型卡的 `configJson` 中，典型结构如下:

```json
{
  "kind": "router",
  "adapter": "codex",
  "candidates": {
    "simple": [
      { "providerProfileId": "openai-fast", "modelId": "gpt-4.1-mini" },
      { "providerProfileId": "aggregator", "modelId": "cheap-backup" }
    ],
    "default": { "providerProfileId": "openai-main", "modelId": "gpt-4.1" },
    "complex": { "providerProfileId": "openai-code", "modelId": "o4-mini" },
    "longContext": { "providerProfileId": "aggregator", "modelId": "long-context-text" }
  }
}
```

运行时路由是确定性的本地判断，不调用远端模型。当前规则优先识别长上下文，其次识别代码开发、重构、debug、测试、方案等复杂任务；短消息或明确简单类请求走 `simple`；缺失目标槽位时回退到 `default`，再回退到任一有效候选。每个槽位可以配置一个或多个候选模型，路由时会按配置顺序选择第一个仍然有效的候选。

当前自动路由只在 turn 开始前选择模型；如果真实 SDK executor 已经开始请求后遇到报错、限流或配额错误，本轮不会自动切换到同槽位下一个候选重试。后续要实现执行期 failover，需要在 Claude/Codex SDK executor 外层增加可重放的 retry wrapper，并明确哪些错误可安全重试、哪些工具调用/写文件场景禁止自动重放。

配置入口在 Providers 页顶部的“自动路由”按钮。创建路由模型时需要选择:

- 路由 Provider: `Claude Auto Router` 或 `Codex Auto Router`；路由模型卡会作为这两个虚拟 Provider 下的模型出现。
- 路由格式: `Claude` 或 `Codex`，创建后固定，避免同一张卡混用两套接口协议。
- 候选模型: `simple/default/complex/longContext` 四个槽位，至少需要配置 `default`；每个槽位可选择多个候选模型作为有序候选池。候选模型只来自兼容 provider，且不包含内置 CLI 自身。

保存后，这张路由卡会立即进入对应自动路由虚拟 Provider 的会话模型选择器和 Agent 默认模型下拉。团队模式不需要额外配置，成员 Agent 保存的 `providerProfileId + modelId` 若指向自动路由虚拟 Provider 与路由卡，执行该成员任务时会独立解析路由。

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

MCP 配置会转成 Codex config 中的 `mcp_servers`。stdio、sse、http 配置会尽量按 Codex 可识别的字段透传。Codex HTTP MCP 不消费通用 `headers.Authorization`；当 Spark MCP 配置里出现 `Authorization: Bearer <token>` 时，Codex SDK/CLI 适配器会把 token 注入子进程环境变量，并在 config 中写入 `bearer_token_env_var`，避免初始化请求丢鉴权，也避免把 token 暴露在 CLI 参数里。对 `spark_*` 内置 MCP，适配器会额外写入 `default_tools_approval_mode = "approve"`，让 Codex CLI/SDK 的非交互执行可以直接调用平台工具；普通用户 MCP 不会被自动放行。

`spark_platform` 是内置 stdio MCP server，当前主要暴露 tools。为了兼容 Codex 启动阶段主动枚举 MCP resources / resource templates / prompts 的行为，server 会对这些可选 list 方法返回空列表，而不是保持沉默导致客户端等待超时。

## 已知后续工作

- Codex CLI 的 JSONL 事件已经覆盖常见工具、终端输出和思考流，但仍需持续跟踪上游 schema 变化与新增 item 类型。
- 流式输出目前仍依赖主事件持久化链路，后续应对高频 delta 做批处理或节流，减少 UI 卡顿。
- 插件和技能已通过 prompt/catalog 注入适配到 Codex SDK，但还需要把 Codex 原生插件/技能能力与 Spark 技能商店做更深的状态联动。
- Codex SDK 依赖 `@openai/codex-sdk`，该包内部会携带并启动 `@openai/codex` CLI。版本升级需要同时关注 npm 供应链延迟策略和 CLI 事件 schema 变化。
