# Computer Use 直接桌面控制实施审查

> 状态: 实施中 | 最后核对: 2026-08-02

## 审查结论

直接控制的代码链已完成，自动化验证通过；真实 DEV 验收尚未完成，因此规格和计划继续保持「实施中」。解锁后的第二次真实运行暴露了三个实现缺陷：GLM 正常响应被严格 parser 误报为 `decision_model_error`、截图证据缺少 session/turn 所有权、其他应用的持续用户输入会被全局 idle 检查误判为接管。本轮均已修复，仍需重启最新 DEV 后复验。

## 已核对行为

- 新 Agent 任务契约固定写入 `allowedApps: []`，Policy 不读取旧应用、域名和数据类别范围。
- 所有八种会话权限模式使用相同启动链；生产执行不读取 `permissionMode`。
- Controller、Renderer IPC、Broker 和 Operator 的生产调用点不再调用持久租约 acquire、heartbeat 或 release。
- `ComputerDesktopExecutionCoordinator` 在内存中串行抢占，等待旧任务完成 Broker/Native Host 清理后才交给新任务。
- 已完成/失败/取消会话的 stop 幂等；启动、恢复、设置禁用、kill switch、托盘控制和终态投影均在 Native 清理后释放 owner。
- Broker 不创建或消费逐动作审批票据；L0-L4、敏感文本、外部写入和 unattended 均直接执行。
- 决策模型不再输出或触发敏感文本 handoff；只保留 Native Host 检测到真实用户接管时的 handoff。
- `WIN`、`WINDOWS`、`CMD`、`COMMAND` 等按键别名归一为 `Meta`。
- 模型非法输出使用 `decision_model_error`；启动路径精确区分 Host 缺失、屏幕录制、辅助功能、输入权限和 Host 不兼容。
- Native Host 的签名、SHA-256、架构、版本、wire protocol 以及系统权限检查仍保留。
- 快照消息保留实际产生顺序，不再被重排到会话末尾。
- `start_task.targetApp` 在 macOS 直接启动/拉起目标应用并等待真实窗口后绑定，省去 Spotlight 多轮视觉操作；未知或无法启动的应用仍回到既有桌面导航。
- Electron AX 语义动作失败信息会进入下一次模型决策，要求改走截图坐标，不再重复同一 `action_noop`。
- Host supervisor 的重启预算按任务结束复位；取消已断连任务不会为了清理再次 acquire Host，后续任务无需重启 SparkWork 即可重新握手。
- Agent 可在不创建长任务的情况下分别调用 `list_apps`、`list_windows`、`get_screen_state`、`get_app_state` 和 `open_app`；原快照与 `start_task` 路径继续保留。
- 应用目录支持运行中、已安装和合并三种范围；已安装目录缓存 5 分钟，Spotlight 元数据查询失败时不阻断运行态结果。
- 单应用状态包含 Native Host AX/视觉观察；活动任务存在时使用独立瞬时连接，避免改变任务连接的窗口绑定和增量观察状态。
- `open_app` 不读取完整 AX 树；可选聊天快照失败时也不会丢弃已取得的应用元数据和观察结果。
- 单步失败会携带失败码、连续次数和已失败交互策略重新规划；连续 noop 达阈值后强制读取完整状态并切换 AX、坐标、键盘、聚焦、原生命令或等待路径，不再立即结束任务。
- 截图证据不可用时降级为 AX-only 决策；验收窗口目录和验收记录持久化故障不再覆盖有效的内存验收结论。
- 有可操作 AX/HTML 树时先无图决策，只有树信息不足或输出无效时才向同一模型发送截图；稳定步骤继续支持小批次执行。
- Anthropic 兼容响应可以包含简短说明、Markdown fence、裸白名单动作或省略 decision 外层；本地规范化后仍经完整 `ComputerActionSchema` 校验。
- 截图证据从 `computer_sessions` 写入真实 session/turn 所有权，不再触发 `snapshot ownership does not match computer session`。
- 用户操作其他应用只产生最多 750 ms 防碰撞等待；只有目标窗口内的输入才触发 handoff。前景动作后仍恢复用户原前台应用和指针。

## 自动化证据

- Desktop Computer Use 与快照排序：42 个测试文件、312 项测试通过。
- Protocol Computer Use：5 个测试文件、33 项测试通过。
- Agent Runtime Computer Use：2 个测试文件、4 项测试通过。
- Desktop、Protocol、Agent Runtime TypeScript typecheck 通过。
- Desktop production build 通过；migration SQL 干跑因本机 Node/Electron `better-sqlite3` ABI 不同而按既有脚本跳过，65 个 migration 静态校验通过。
- `git diff --check` 通过。

本次可靠性增量的完整 Computer Use 证据：43 个测试文件、294 项测试通过；Desktop TypeScript typecheck 与相关 ESLint 通过。真实哔哩哔哩端到端验收仍需在用户已解锁且安装目标应用的 DEV 环境执行。

本次桌面状态能力增量的完整证据：45 个测试文件、306 项测试通过；Desktop、Protocol、Agent Runtime TypeScript typecheck、相关 ESLint、`git diff --check` 与 Desktop production build 通过。ESLint 只有既有测试文件中的 19 个 non-null assertion 警告，零 error；migration 静态校验通过，SQL 干跑仍因本机 Node/Electron `better-sqlite3` ABI 差异按既有脚本跳过。

本次失败降级增量将完整回归提升为 45 个测试文件、309 项测试通过，Desktop main/node TypeScript typecheck、相关 ESLint 和 `git diff --check` 通过。完整 Desktop typecheck 当前被并行画布改动 `canvas.api.ts` 的 `"group"` 与 `CanvasOperationType` 不匹配阻塞；Computer Use 变更自身无类型错误。

本次树优先与并行桌面增量的针对性证据：5 个测试文件、44 项测试通过；Agent Runtime 与 Desktop Node TypeScript typecheck 通过；macOS Native Host 43 项测试通过；Windows Host Rust 格式检查通过。最新 macOS Host 已复制到 DEV Electron resources，重启 DEV 即可加载。

## 真实 DEV 记录

首次可调试 DEV 启动后，旧 Codex CLI 凭据在 Agent 层返回 HTTP 401，尚未进入 Computer Use。切换到已配置的 `gpt-5.6-sol` 后，DEV 成功创建新 Computer session：契约 `allowedApps` 为空、`actuatorLeaseId` 为空、无审批票据、无租约冲突。随后首个观察在约 3.8 秒后以 `sensitive_input_blocked` 结束。

通过 AppKit 读取当前前台应用，确认当时及复核时均为 `loginwindow (com.apple.loginwindow)`，不是哔哩哔哩或 SparkWork 普通窗口。因此这次失败属于系统安全桌面边界，不是本轮治理链残留。解锁后必须重新启动最新 DEV 并再次执行原始任务；只有哔哩哔哩客户端内可见 `comfyui 教程` 搜索结果，才可把规格与计划状态改为「已落地」。

解锁后的 GLM‑5.2 运行创建了 Computer session `872a4f15-3f06-4211-a67d-d1a9a182037b`。08:01:13–08:02:05 的九次 Anthropic 多模态调用全部返回 `end_turn` 和非空文本，期间产生三次有效观察但零动作，最后被本地 parser 统一记为 `decision_model_error`；因此不能归因于 GLM 图像能力。同时日志三次出现 `snapshot ownership does not match computer session`。这些证据直接驱动了本轮 parser、树优先策略和证据归属修复。
