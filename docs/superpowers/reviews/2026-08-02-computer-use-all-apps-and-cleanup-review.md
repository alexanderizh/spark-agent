# Computer Use 全应用控制与终止清理审查

## 结论

本轮修复移除了应用白名单的运行时语义，并补齐 Agent turn 与 Native Host 持续捕获之间的清理链路。默认 My Desktop 任务可操作所有正常桌面应用；显式目标仅约束精确窗口，不要求应用预先登记。

## 根因

1. 旧修复只把单应用白名单扩展成“启动时可见应用 + 新应用首次升档”，`allowedApps` 仍被 Controller、Policy、IPC 和 Renderer picker 使用。
2. Agent turn 的 `revokeSession` 只撤销 MCP token 和截图 capability，没有停止该聊天会话创建的 Computer Use 子会话。
3. operator 自然完成或失败只清理证据缓存，没有调用 Native Host `cancel_session`；macOS 持续 `SCStream` 因此可能继续显示系统控制标记。
4. 初始观察通常发生在调用工具时仍聚焦的 Spark 窗口；当任务在切换应用前失败且捕获未清理时，控制标记就会残留在 Spark。

## 改动

- `allowedApps` 允许为空；新任务统一写空数组，旧值仅用于持久化兼容并被 Policy 忽略。
- 移除新应用首次动作升档、显式窗口换绑的应用过滤和 Renderer 目标选择器过滤。
- Agent system prompt 与 decision prompt 明确“所有应用可操作、当前前台不是范围限制”，要求通过系统启动器切换或打开目标应用。
- MCP session revoke 停止该 Agent 会话拥有的所有活动 Computer Use 子会话。
- operator 成功或失败均调用 Native Host `cancel_session`；macOS Host 随后执行 `SCStream.stopCapture()`，Windows Host 清空 persistent capture session。
- 初始目标进程是 Spark 自身时使用一次性截图而非持续捕获；切换到外部应用后才启用 persistent capture，避免把产品自身长期显示为受控目标。
- 状态 UI 与系统托盘默认展示“所有应用”，不再展示白名单首项。

## 保留边界

- 保留操作系统屏幕录制/辅助功能/输入权限。
- 保留 Native Host 签名、hash、架构和协议校验。
- 保留观察帧与动作目标一致性校验；身份漂移使用 `focus_mismatch`，不再使用易被误解为白名单的 `app_not_allowed`。
- 保留凭据、支付、删除、权限变更等高风险动作的确认或接管规则。

## 验证范围

- 协议空应用集合兼容。
- 任意应用的默认执行与显式窗口绑定。
- Agent session revoke 到 Broker stop 的级联清理。
- operator 终态到 Native Host cancel 的资源释放。
- Renderer picker 展示所有可见应用。
- Computer Use 聚焦回归、desktop typecheck 与最终 diff 三遍复核。

## 2026-08-02 续：执行器租约与真实任务验收

一次真实桌面任务“打开哔哩哔哩并搜索 `comfyui 教程`”复现了 `actuator_lease_conflict`。Native Host 诊断和屏幕录制、辅助功能、输入权限均正常；失败发生在任何桌面动作开始之前。该次运行同时返回了旧的非空 `allowedApps`，表明它仍由重载前的打包主进程处理，不能用来否定源码修复或充当修复后的端到端验收。

根因与修复：

- `handoff_required` 会话保留全局执行器租约，下一任务在租约 TTL 内必然冲突。现在保留可接管的会话状态，但立即归还租约。
- `start_task` 先创建会话、后获取租约；获取失败时此前会遗留一个 preflight 会话。现在立即停止该会话并取消 Host/应用控制资源，再将真实冲突返回调用方。
- 数据库获取新租约前除清理过期租约外，也清理 `completed`、`failed`、`canceled` 会话遗留的活跃租约，处理历史异常和进程中断留下的脏数据。

验证证据：

- `ComputerSessionManager` 与 `ComputerUseAgentController` 聚焦回归：27/27 通过。
- MCP 桥接与 session revoke 回归：7/7 通过（需要允许测试监听本地 `127.0.0.1`）。
- TypeScript：`packages/storage` 与 `apps/desktop` typecheck 通过；desktop production build 通过，生成的 main bundle 已包含 `allowedApps: []`、handoff 释放租约和租约失败收口。
- 存储仓库的 Vitest 运行受本机 `better-sqlite3` Electron ABI 148 / Node ABI 127 不匹配阻断，未进入任何断言；使用 SQLite 内存事务验证了相同的“终态会话遗留租约 → 释放 → 下一任务成功获取”SQL 语义。

**发布前必做的真实验收**：完整重启 Electron 主进程后，重新执行上述哔哩哔哩搜索任务；只有在应用内出现 `comfyui 教程` 搜索结果后才能标记为成功。不得以应用被打开、深链跳转、或模型文字回复替代此验收。

## 2026-08-02 续：慢模型租约续期与快照时间线

真实失败记录显示，任务通常在约十秒后报 `actuator_lease_conflict`。根因不是另一任务永久占用执行器：默认租约为 10 秒，而视觉模型决策、截图读取或审批等待可超过该窗口；此前这些等待期间没有续租，导致任务在派发第一步动作时发现自己的租约已经过期。

- `ComputerTaskOperator` 现在从首次观察前开始每两秒续租，覆盖观察、模型决策和审批等待；一旦任务结束，定时器立即停止。续租失败仍 fail-closed，不会继续派发动作。
- 应用快照不再按“交付文件”被移到会话尾部；它保留在产生该快照的工具调用与后续推理之间。

验证：新增慢模型决策保活回归与快照排序回归；ComputerTaskOperator、event mapper、renderer 排序共 67 项通过，desktop typecheck 与 production build 通过。一次经由当前 MCP 服务的真实调用仍返回旧的非空 `allowedApps`，确认该服务连接的是打包应用而非刚重启的 dev Electron，因此该失败不能作为新 dev 代码的端到端结果；dev 主进程已独立启动并加载含 `allowedApps: []` 与租约保活逻辑的构建产物。
