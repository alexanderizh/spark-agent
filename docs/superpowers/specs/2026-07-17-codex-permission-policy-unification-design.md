# Codex 权限策略统一设计

> 状态: 待开发 | 最后核对: 2026-07-17

## 背景

Spark 同时通过 `@openai/codex-sdk` 和 Codex CLI 执行 Codex 会话，并在平台层提供“请求批准”“替我批准”“完全访问”三档权限。当前两个执行器分别维护映射逻辑，已经出现语义漂移：

- SDK 执行器仅在 `codex-full-access` 下使用 `danger-full-access`；其他模式使用 `workspace-write`。
- CLI 执行器在所有无人值守任务中直接使用 `--dangerously-bypass-approvals-and-sandbox`，可能绕过用户选择并扩大权限。
- “替我批准”目前只设置了 `on-request`，没有配置 Codex 官方自动审查器，平台文案与真实运行行为不完全一致。
- SDK 与 CLI 对同一权限模式生成不同参数，后续升级容易再次漂移。

用户需要由 Spark 权限策略明确控制 Codex 的真实沙箱和审批行为。尤其是用户选择“完全访问”时，SDK 和 CLI 都必须明确启用 `danger-full-access`，从而允许写入 `.git` 以及执行分支、暂存、提交等 Git 操作。

## 官方能力依据

本设计只使用 Codex 官方文档和项目锁定 SDK 已公开的能力：

1. Codex 将权限拆成两个维度：沙箱决定技术上可以访问什么，审批策略决定何时需要批准。
2. `workspace-write` 允许工作区文件写入，但 `.git`、`.agents` 和 `.codex` 是递归只读保护路径；Git worktree 的 `.git` 指针所指向的真实 Git 目录同样受保护。
3. `danger-full-access` 取消文件系统沙箱限制；`approval_policy="never"` 只关闭审批，本身不会扩大沙箱。
4. 自动审查是审批者替换机制。官方组合为交互式审批策略与 `approvals_reviewer="auto_review"`；它不会把整个会话永久升级为全权限，但可以审查单次越界请求。
5. 项目锁定的 `@openai/codex-sdk@0.144.5` 中，`ThreadOptions` 公开支持 `sandboxMode`、`approvalPolicy`、`workingDirectory` 和 `additionalDirectories`；`CodexOptions.config` 支持向 CLI 传递通用配置覆盖。
6. `startThread(options)` 和 `resumeThread(id, options)` 都接受同一份 `ThreadOptions`，因此新建和恢复会话可以使用同一策略。
7. 当前 TypeScript SDK 的 `ThreadEvent` 不包含审批请求事件，也不公开审批回调。Spark 可以预设 `on-request` 或启用 Codex 自动审查，但不能仅靠现有 SDK 将单次沙箱审批接入平台现有用户问询弹窗；需要完整交互式审批时应另行评估官方 App Server。

参考资料：

- [Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)
- [Sandboxing](https://learn.chatgpt.com/docs/sandboxing)
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
- [Codex SDK TypeScript source](https://github.com/openai/codex/tree/main/sdk/typescript)

## 设计目标

- 权限完全由用户在 Spark 中选择的模式决定。
- SDK 与 CLI 对同一模式产生相同的 Codex 沙箱和审批语义。
- “完全访问”明确映射为 `danger-full-access`，允许写 `.git`。
- 无人值守属性不能自动扩大沙箱权限。
- “替我批准”真正接入 Codex 官方自动审查，而不是只设置 `on-request`。
- 新建会话、恢复会话、普通聊天、画布 Agent、团队成员和定时任务复用同一映射。
- 保留 Spark 对模型、MCP、网络、技能和附加工作目录的现有包装能力。

## 非目标

- 本次不引入 Codex Beta permission profiles，也不新增独立的“允许 Git 写入”第四档权限。
- 本次不迁移到 Codex App Server，也不伪造 TypeScript SDK 尚未公开的人机审批回调。
- 本次不绕过组织级 `requirements.toml`、操作系统权限、容器挂载或管理员策略。
- 本次不改变 Claude Agent SDK 的权限模式。
- 本次不承诺 `workspace-write` 可以通过 `additionalDirectories` 或 writable roots 解锁 `.git`；官方策略明确保护该路径。

## 权限矩阵

| Spark 权限模式 | Codex 沙箱 | 审批策略 | 自动审查器 | Git 元数据行为 |
| --- | --- | --- | --- | --- |
| `codex-default` | `workspace-write` | 交互会话为 `on-request`；无人值守为 `never` | 无 | 默认禁止写 `.git`；当前 SDK 无审批回调时，未能完成审批的越界请求会被拒绝 |
| `codex-auto-review` | `workspace-write` | `on-request` | `auto_review` | 默认禁止写 `.git`；由 Codex 自动审查器处理单次越界请求 |
| `codex-full-access` | `danger-full-access` | `never` | 无 | 允许写 `.git`，无需逐次审批 |

无人值守只影响审批能否等待人工，不改变用户选择的沙箱：

- `codex-default + unattended` 保持 `workspace-write`，使用 `never`，越界操作失败而不是挂起。
- `codex-auto-review + unattended` 保持 `workspace-write`，继续由 `auto_review` 处理越界请求。
- `codex-full-access + unattended` 保持用户明确选择的 `danger-full-access`。

## 架构

新增一个 Codex 专用的共享权限策略模块，输入 Spark 权限模式和 `unattended`，输出与执行器无关的语义对象：

```ts
interface CodexPermissionPolicy {
  sandboxMode: 'workspace-write' | 'danger-full-access'
  approvalPolicy: 'never' | 'on-request'
  approvalsReviewer?: 'auto_review'
}
```

共享解析器只负责策略，不拼装 CLI 参数，也不依赖 SDK 类型。两个适配器分别把语义对象渲染到真实接口：

- SDK 适配器将 `sandboxMode`、`approvalPolicy` 放入 `ThreadOptions`，将 `approvals_reviewer` 放入 `CodexOptions.config`。
- CLI 适配器使用显式 `--sandbox <mode>`，并在临时 profile 中写入 `approval_policy` 和可选的 `approvals_reviewer`。

不再使用 `--dangerously-bypass-approvals-and-sandbox` 表达普通权限映射。完全访问改用显式的 `--sandbox danger-full-access` 和 `approval_policy='never'`，使 CLI 与 SDK 参数可直接比较，也避免无人值守分支暗中扩大权限。

## Spark 平台集成

权限来源继续使用现有 `SDKExecutorConfig.permissionMode`，不新增会话存储字段，因此兼容现有会话和 IPC 协议。

数据流如下：

1. 用户在 Composer、Agent 设置、画布 Agent 或任务配置中选择权限档位。
2. SessionService 将已有 `permissionMode` 写入本轮 `SDKExecutorConfig`。
3. SDK 或 CLI 执行器调用共享解析器。
4. 执行器将策略映射到官方支持的 SDK options 或 CLI/profile 配置。
5. SDK 新建与恢复线程都调用同一个 `buildThreadOptions`，保证恢复会话不会沿用旧权限。

现有 Spark 包装能力保持不变：

- 模型供应商与自定义 Base URL 配置继续进入 Codex config。
- Spark MCP 服务继续使用现有 approval mode、鉴权环境变量和静态 Header 处理。
- 网络访问和 web search 继续由现有字段控制；“完全访问”不擅自改写用户的平台网络开关。
- `additionalDirectories`、附件、reasoning effort、原生技能开关和 goals 配置保持原路径。
- `skipGitRepoCheck` 仍只表示允许非 Git 工作目录，不作为权限绕过手段。

## UI 文案

三档权限名称保持不变，避免迁移已有用户设置。描述调整为真实行为：

- 请求批准：可编辑工作区；Codex 对越界操作采用 `on-request`，当前 SDK 无法向 Spark 回传审批时操作可能被拒绝，无人值守时直接拒绝。
- 替我批准：可编辑工作区；风险或越界操作交给 Codex 自动审查。
- 完全访问：Codex 可不受文件沙箱限制地访问文件并修改 Git 状态；仅用于可信环境。

Composer 与共享权限选项必须使用同一份描述，避免不同入口显示不同语义。本次优先复用现有共享常量；无法直接复用的入口至少由测试锁定一致性。

## 错误与降级

- 若组织级要求禁止 `danger-full-access`，Codex 的真实错误原样进入终端事件，最终消息说明是管理员策略阻止，Spark 不自动降级或绕过。
- 若当前 Codex 运行时不支持 `approvals_reviewer`，执行器应报告配置错误，不静默把“替我批准”伪装成普通 `on-request`。
- 若 `codex-default` 发起了现有 TypeScript SDK 无法回传的人工审批请求，Spark 保留 Codex 的拒绝或阻塞说明，不把它误报为用户已经拒绝。完整的人机逐次审批留给后续 App Server 方案。
- 若宿主环境将 `.git` 挂载为只读，即使选择完全访问仍会失败；这是外层环境限制，不由 Spark 提权。
- 恢复会话时始终重新传入当前轮权限，用户修改权限后下一轮生效。

## 测试策略

### 共享策略单元测试

覆盖三种权限模式与 `unattended` 的完整矩阵，重点断言：

- 只有 `codex-full-access` 返回 `danger-full-access`。
- `unattended` 不会把任何模式升级为 `danger-full-access`。
- `codex-auto-review` 返回 `on-request + auto_review`。
- `codex-default + unattended` 返回 `workspace-write + never`。

### SDK 执行器测试

- 新建和恢复会话都接收相同权限 options。
- 完全访问传入 `sandboxMode: 'danger-full-access'` 和 `approvalPolicy: 'never'`。
- 自动审查通过 `CodexOptions.config.approvals_reviewer` 启用。
- 网络、MCP、模型供应商和附加目录配置不受影响。

### CLI 执行器测试

- 三档模式生成与共享策略一致的 `--sandbox` 参数和 profile 配置。
- 无人值守自动审查不再出现 `--dangerously-bypass-approvals-and-sandbox`。
- 完全访问使用显式 `danger-full-access`。
- 临时 profile 生命周期和清理逻辑保持不变。

### 平台回归测试

- IPC/session runtime 继续透传用户选择的 `permissionMode`。
- Composer、设置页、Agent 页中的权限值保持协议兼容。
- 相关 SDK/CLI executor、session runtime 和 schema 测试通过。

## 文档与索引

实现完成后将本文状态更新为“已落地”，刷新最后核对日期，并在相关开发文档中补充最终权限矩阵。根据仓库约定，在功能完成后运行 GitNexus 索引更新；若 GitNexus 不可用，则使用调用点检索、测试和 `git diff` 完成影响核对并注明降级原因。
