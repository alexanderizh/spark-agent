# PRD: Session SDK 权限策略

> 版本: 1.0  
> 日期: 2026-05-28  
> 状态: 已实现第一阶段  
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
| `codex-default` | 当前未接通 Codex SDK | 预留 | 普通安全色 |
| `codex-auto-review` | 当前未接通 Codex SDK | 预留 | Auto 色 |
| `codex-full-access` | 当前未接通 Codex SDK | 预留 | 危险色 |

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
