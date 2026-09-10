# Spark Engine CLI / SDK 运行时说明

> 状态: 已落地 | 最后核对: 2026-09-11

本文记录 `spark-engine` 当前可验证的提示词归属、外部注入、MCP stdio/Streamable HTTP、模型预算解析、TUI 工具日志和同步 `task` 子代理边界。

## 提示词归属

| 层级 | 位置 | 用途 |
| --- | --- | --- |
| 内核稳定提示词 | `spark-engine/src/prompts/kernel.ts` | CLI、TUI、SDK 共用的 `spark-kernel-contract`，适合作为上游缓存的稳定前缀 |
| 项目指令加载 | `spark-engine/src/memory/instructions.ts` | 加载 `~/.spark/SPARK.md` 及目录链上的 `SPARK.md` / `AGENTS.md` / `CLAUDE.md` |
| 提示词组装 | `spark-engine/src/events/projector.ts` | 按稳定 section → `runtime` → `budget-warning` 组装 system sections；宿主提示词和技能快照独立成 stable section |
| task 工具说明 | `spark-engine/src/tools/task/definition.ts` | 告诉模型何时及如何调用同步子代理，以及参数和白名单边界 |

运行时 `sessionId`、工作目录和权限档属于 volatile section，不应写进 `kernel.ts`，否则会缩短跨轮次、跨会话的上游前缀缓存命中长度。

桌面宿主的 `systemPrompt`、`skillSystemPrompt`、`customEnv`、`allowedTools`、`disallowedTools` 已由 `SparkEngineExecutor` 传入 Spark env。`systemPrompt` 和技能快照进入独立的 stable system sections；`customEnv` 只覆盖工具子进程环境，不写进提示词或宿主 `process.env`；allowed/disallowed 按 Claude/Codex 语义分别作为免审批名单与强制拒绝名单。

## MCP 与外部调用

第一批已接通 MCP stdio 和 Streamable HTTP：

- `createDefaultEnvWithMcp()` 连接宿主传入的 stdio server，完成 MCP initialize 和 `tools/list`（含分页）；
- 工具按 `mcp__<server>__<tool>` 注册进 Spark ToolRegistry，沿用 schema 校验、事件账本、输出治理和 manual/auto/bypass 权限链；
- MCP 返回的文本、资源和多媒体块会安全转换为文本工具结果；取消和工具超时通过 MCP SDK 的 AbortSignal/timeout 传递；
- managed env 关闭时统一关闭 MCP client，避免 stdio 子进程残留；连接/配置失败返回 `spark_external_injection_failed`。

当前边界：旧 SSE/OAuth、CLI `~/.spark/mcp.json` 配置文件加载、Skill 渐进式披露/Skill 工具和后台 agent 生命周期仍是后续批次；宿主已有 `type=sdk` 的进程内 MCP server 也不会被误当成 stdio。

## 模型预算与请求上限

模型预算不再由单一全局常量决定，统一解析顺序为：

1. 当前 turn 的显式 `maxTokens`（但不能超过模型硬上限）；
2. SparkWork route 的 `maxTokens` 与模型/Provider `contextWindow`；
3. standalone CLI 模型配置中的 `max_tokens` 与 `context_window`；
4. 没有元数据时的保守 SDK fallback。

每次请求会用 system、消息和工具定义做保守输入 token 估算，再以 context window 的剩余空间收敛 `max_tokens`。reasoning tokens 与可见正文共享上游输出上限；Anthropic 的 `budget_tokens` 会在协议层保证正文保留量，OpenAI Responses 的 `max_output_tokens` 包含 reasoning 与正文。预算不足时返回 `llm.context_window_exhausted`，不把上游 400 或空正文伪装成正常完成。

桌面端通过 SparkWork loopback bridge 把 Provider 的 `maxTokens` 和模型级/Provider 级上下文窗口传给 CLI；Spark executor 同样消费 `SDKExecutorConfig.maxTokens`、`contextWindowTokens` 和 `reasoningBudgetTokens`。CLI `/model` 切换后，`SwitchableLlmService` 会随当前 route 更新预算，task 子代理和 failover route 继续沿用各自的上限。

## 模型流式容错

Spark CLI 对请求建立前或尚未产生可见内容的瞬时故障执行有上限的指数退避，并遵守 Provider 的 `retry-after`。usage、continuation 和 done 属于单次尝试的记账事件：在流完整结束前暂存，失败尝试不会把这些状态泄漏到上层或阻止安全重试。

每次自动重试都会发出结构化 retry delta，包含 route、次数、等待时长和安全错误摘要。TUI 显示“正在重连模型”及进度，纯文本模式写入 stderr，stream-json 模式原样输出 delta，宿主无需解析日志文本。

`[agent]` 可通过 `max_retries`、`retry_initial_delay_ms`、`retry_max_delay_ms` 和 `retry_jitter_ratio` 调整重试预算与指数退避；默认分别为 2、500ms、60000ms 和 0.2。Provider 返回的 `retry-after` 超过等待上限时不会被强行截短后快速重试：当前路由立即停止重试并尝试 failover，没有备用路由时返回 `llm.retry_delay_exceeded`。

协议层会把限流、过载、服务端故障和桥接断流归为瞬时错误；无效请求、认证/权限/计费失败、内容过滤和上下文超限归为永久错误并立即返回，避免无意义等待与重复计费。

一旦已经输出文本、思考内容或完整工具调用，CLI 不自动重放整个请求，避免重复显示和重复副作用。此时 `llm.partial_stream_failed.detail` 会记录输出阶段、字符数、工具调用数和底层结构化错误，TUI 与纯文本模式直接附带根因和重试建议。所有外部错误详情都会限制长度、深度和字段数量，清理终端控制字符并对凭据形态字段脱敏。

SparkWork loopback bridge 只向 CLI 转发完整 SSE 帧；上游若在半个 JSON 中断，未完成尾帧会被丢弃，再发送独立的 Anthropic/OpenAI 协议 error 事件，保留 `ECONNRESET` 等错误码和消息。standalone Provider 的响应体读取异常则由通用 SSE 层包装为可重试的 `llm.sse_stream_error`。支持 continuation/resume 的 Provider 后续可以在这一安全边界上增加专用续传。

## TUI 工具日志

TUI 从事件账本投影展示，不依赖临时控制台输出：

- `tool.call`：展示工具名称和经过提炼的参数摘要；不打印 write 内容、task 完整 prompt 等大字段。
- `tool.intent`：展示等待审批或已经调度的活动状态。
- `tool.result`：展示成功/失败、格式化耗时和有界结果预览；task 的 `childSessionId` 作为可选结构化字段落账，完整结果仍保留在账本并回传模型。
- 结果预览最多 6 行、720 字符，并将终端控制字符可视化，避免工具输出清屏、改标题或伪造终端状态。
- 普通回答、思考、工具块之间保留纵向留白；底部状态栏只显示模型、权限值、推理强度值、性能、目录和 `/help`。

## 同步 task 子代理可观测性

`task` 是同步前台工具，不是完整的后台多 Agent 管理器。TUI 会显示：

- 描述和能力范围（默认 `read-only`，或显式 `allowed_tools`）；
- 等待审批、已调度、完成或失败；
- 执行耗时、子 session 短 ID 和子代理最终结果摘要。

子 session 完成后，即使 TUI 只展示有界摘要，父模型仍会收到完整 `tool.result.content`。后台等待、转向、发消息、停止、关闭和 `/agent` 线程切换仍属于后续独立生命周期协议，不能视为本工具已支持。

## 执行可靠性（2026-09-10）

PreToolUse hook 的 approve 仅免除策略产生的交互 ask；仍先检查宿主 disallowedTools 和策略拒绝，策略异常继续 fail closed。命令取消在 POSIX 上对整个进程组升级发送 SIGKILL，即使父进程已正常退出，仍清理占用输出管道的后代。

共用内核提示词增加操作、失败诊断与验证交付约定。当前改进和后续长命令、后台 Agent、核心替换准入见 [执行路线](spark-engine-execution-roadmap.md)。

## 终端执行反馈与输入（2026-09-10 第二批）

- 工具状态按账本区分准备中、等待审批、已调度；只有 permission.requested 且尚未决定的调用显示等待审批。
- 活动工具关联所属 turn。所属任务终止后移出活动列表；其他排队任务被取消不影响正在运行的工具。隐藏活动项不代表工具执行成功，实际结果仍以账本为准。
- assistant.completed 落账即移除对应临时流式文本和思考，避免同一内容重复展示。
- Esc 中断后显示等待工具清理并保留输入草稿；清理结束后恢复正常输入状态。运行期间提示 Enter 将新输入加入队列。
- 上下键可以连续翻看输入历史；编辑取回的内容后退出历史浏览，避免下一次方向键丢失修改。
- Ctrl+O 在全屏可滚动终端中同时切换实时与已完成思考。缺少终端高度、使用 Static 输出的环境只能隐藏实时思考，已写入终端滚动历史的内容不撤回。
- CLI 输入启用 bracketed paste；超过 8 行或 1,000 字符的粘贴内容在草稿中折叠为单个块，提交仍保留完整原文，Backspace/Delete 可整块删除，Ctrl+E 可展开检查。
- turn Promise 或命令处理失败会显示错误并恢复输入，不再成为未处理的 Promise rejection。

终端根布局显式采用终端列宽，输入框和审批区随宽度收敛。审批期间 Esc 提示为拒绝当前工具，非审批期间为中断当前任务；两者不混用。

## 失败诊断保留（第三批）

进程取消、信号退出或输出超限时，保留已经捕获的有界 stdout/stderr；首个输出块超过限制时仍保留限制以内的前缀。错误通过 ToolExecutionError 传递，保留原 KernelError 错误码，取消仍使用 AbortError 名称。工具收尾将部分输出写入既有 tool.result，继续走 artifact 大输出治理与 TUI 有界预览。

即使执行器在取消或超时信号后返回 ok=true，内核仍记录 ok=false，提示结果未确认、重试前核对实际状态。保留输出不表示操作成功，也不自动重新执行命令。当前仍为前台执行，不代表已经支持后台进程恢复或增量等待协议。

## 任务内受管命令（第四批）

默认工作区工具提供可选 bash yield_ms 与 process_wait/process_cancel。输出分页、任务归属、取消和结束检查接入同一工具账本；MCP 组合执行器转发清理。当前限 POSIX、单任务内存记录及 120 秒生命周期，详见 [协议和边界](spark-engine-managed-processes.md)。前面第三批描述的“尚无等待协议”仅记录当时状态，以本节为准。
