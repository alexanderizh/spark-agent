# PRD: Session SDK 权限策略

> 状态: 已落地（第一阶段已实现） | 最后核对: 2026-06-19
>
> 版本: 1.0  
> 日期: 2026-05-28  
> 范围: Claude Agent SDK 执行路径、Spark 权限审批、Composer 与设置页权限模式、会话创建默认策略

## 1. 背景

Spark Agent 的 Claude 执行路径已经切换为 Claude Agent SDK。SDK 自带 `permissionMode` 能力，Spark 也有 profile/rule/decision 体系。两套权限系统需要明确分工:

- 优先使用 Claude SDK 原生权限策略，保持与 Claude Code 行为一致。
- Spark 只补充 SDK 没有覆盖的产品能力，如 project/global 记忆、风险提示、审计事件和 UI 联动。
- `auto` 模式必须保留 SDK 自主决策能力，避免 Spark 强制弹窗破坏自动化体验。
- `bypass` 是危险模式，代表完全听从 agent 执行，必须在 UI 中持续显示风险态。

## 2. 权限模式语义

| Spark 模式 | SDK 模式 | Spark 扩展 | UI 表现 |
| --- | --- | --- | --- |
| `claude-ask` | `default` | 工具调用进入 Spark approval callback，支持 once/session/project/global | 普通安全色 |
| `claude-auto-edits` | `acceptEdits` | 编辑类工具自动允许，命令/网络/MCP 仍可进入审批 | Auto 色，说明“编辑自动接受” |
| `claude-plan` | `plan` | `ExitPlanMode` / `EnterPlanMode` / `AskUserQuestion` 控制工具自动允许 | 普通安全色 |
| `claude-auto` | `auto` | 不挂 Spark `canUseTool`，由 SDK 自带策略接管 | Auto 色，说明“SDK 自动权限策略” |
| `claude-bypass` | `bypassPermissions` | 不挂 Spark `canUseTool`，仅保留 SDK 传入配置 | 危险色，显示警告图标 |
| `codex-default` | Codex CLI `--sandbox workspace-write` | 走宿主 Codex 配置；Spark 注入规则、skills、会话历史与 CLI-compatible MCP | 普通安全色 |
| `codex-auto-review` | Codex CLI `--sandbox workspace-write` | 当前 Codex CLI 无单独 `--ask-for-approval` 开关，权限由 Codex CLI 自身策略处理 | Auto 色 |
| `codex-full-access` | Codex CLI `--dangerously-bypass-approvals-and-sandbox` | 完全跳过 Codex CLI 审批与沙箱，仅用于用户明确选择的高信任任务 | 危险色 |

## 3. 工具动作归一化

Spark approval callback 接收 SDK 原生工具名。权限服务必须先归一化为 Spark action:

| SDK 工具 | Spark action |
| --- | --- |
| `Read` / `LS` / `Glob` / `Grep` | `file_read` |
| `Write` / `Edit` / `MultiEdit` / `NotebookEdit` | `file_write` |
| `Bash` | `command_exec` 或 `command_dangerous` |
| `WebFetch` | `network_unknown` |
| `WebSearch` | `network_known` |
| `Task` / `Agent` / `mcp__*` | `mcp_tool` |

危险 Bash 命令会升级到 `command_dangerous`，当前覆盖 `rm -rf`、`git clean -fdx`、`git reset --hard`、`sudo`、递归 chmod/chown、`dd if=`、`mkfs`、fork bomb 等高风险模式。

## 4. 审批行为

- `allow`: 直接允许，除非调用方显式 `forcePrompt`。
- `ask`: 弹一次审批。
- `ask-twice`: 连续两次审批都通过才允许，任一拒绝即拒绝。
- `deny`: 直接拒绝。
- `allow-session`: 只写入进程内 session allowance，取消/删除/清空会话时清理。
- `allow-project` / `allow-global`: 写入 `permission_decisions`。
- `deny-project` / `deny-global`: 写入 `permission_decisions` 并阻断后续匹配请求。

## 5. UI/UX 要求

- Composer 权限模式下拉展示模式说明，降低用户误解。
- 设置页“权限策略”需要提供 SDK 执行默认策略设置，并与 Composer 共用默认偏好。
- 设置页 SDK 执行默认策略必须写入 SQLite-backed `app_settings`，不能只停留在 renderer localStorage。
- 设置页切换默认执行器时，需要自动回落到该执行器支持的安全默认权限模式。
- `Auto` / `Auto accept edits` 使用轻量自动化色和闪电图标。
- `Bypass permissions` / `完全访问` 使用危险色和警告图标，选中后触发器也保持危险态。
- 设置页选择危险模式时，必须展示持续可见的危险提示，明确说明会跳过人工审批。
- 审批卡片继续按 `riskLevel` 区分 low / medium / high。

## 6. 验收标准

- SDK `auto` / `bypassPermissions` 模式下，Spark 不注册 `canUseTool`，避免拦截 SDK 自带权限策略。
- `acceptEdits` 模式下，编辑类工具不弹 Spark 审批，`Bash` 仍可进入审批。
- SDK 原生工具名能命中正确 Spark action。
- 危险 Bash 能进入 `command_dangerous` 并触发双重确认。
- Renderer 权限审批和 Composer UI 测试通过。
- 设置页权限模式选择会写入 `app_settings(runtime-permissions/defaults)`，并同步 `spark-agent:composer-prefs` 作为 renderer 快速缓存。
- `session:create` 请求未显式携带 adapter / permissionMode 时，主进程从 `app_settings(runtime-permissions/defaults)` 读取默认策略。

## 7. 附件输入

- Composer 支持在单轮消息中选择本机文件或图片，`session:send-turn` 通过可选 `attachments` 字段传递 `{ type, path }`。
- 主进程使用原生打开文件对话框返回真实文件路径，支持多选。Renderer 只负责展示附件 chip 和后缀识别，文件可用性由 runtime 执行前校验。
- SessionService 在启动 turn 前校验附件存在且为文件，并将附件路径整理为 SDK prompt 中的显式 “User-selected attachments” 清单。
- 附件位于 workspace 之外时，SessionService 会把附件目录写入 Claude SDK `additionalDirectories`，让 SDK 的 `Read` 工具可以读取用户明确选择的文件。
- 单轮最多 20 个附件；附件不写入数据库，只作为当前 turn 的临时输入和提示词快照审计信息。

## 8. Codex CLI 执行路径

- 本地 `local-codex-cli` provider 使用模型显示名 `codex cli`，执行时不把该占位名传给 `codex exec --model`，实际模型由宿主 `~/.codex/config.toml` / Codex 登录态决定。
- Codex adapter 通过 `CodexCliExecutor` 启动真实 `codex exec --json --output-last-message` 子进程，不再走旧 in-process AgentLoop，也不再抛 `SDK_REQUIRED`。
- Spark 运行时仍在 turn 启动前组装 managed agent prompt、规则、记忆、项目上下文、会话历史、显式 skill prompt 和可用 skills catalog，并作为 Codex CLI 初始 prompt 注入。
- 普通 stdio / SSE / HTTP MCP server 会转换为 Codex CLI `-c mcp_servers.*` 配置；同进程 SDK MCP（例如 `spark_team`）不会传给 Codex CLI 子进程。
- Codex CLI 当前只回传 JSONL/最终消息文件，Spark 将其映射为 `terminal_output`、`assistant_message`、`agent_status` 和错误事件；更细粒度的 tool/file/change 事件待 Codex CLI JSONL schema 稳定后扩展。
