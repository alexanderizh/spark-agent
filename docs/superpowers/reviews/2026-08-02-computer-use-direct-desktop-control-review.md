# Computer Use 直接桌面控制实施审查

> 状态: 实施中 | 最后核对: 2026-08-02

## 审查结论

直接控制的代码链已完成，自动化验证通过；真实 DEV 验收尚未完成，因此规格和计划继续保持「实施中」。当前唯一真实验收阻塞是 macOS 前台处于 `loginwindow` 系统安全桌面，Native Host 按既定边界返回 `sensitive_input_blocked`。该系统安全界面不能由 Agent 绕过，必须由用户解锁后重跑。

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

## 自动化证据

- Desktop Computer Use 与快照排序：42 个测试文件、312 项测试通过。
- Protocol Computer Use：5 个测试文件、33 项测试通过。
- Agent Runtime Computer Use：2 个测试文件、4 项测试通过。
- Desktop、Protocol、Agent Runtime TypeScript typecheck 通过。
- Desktop production build 通过；migration SQL 干跑因本机 Node/Electron `better-sqlite3` ABI 不同而按既有脚本跳过，65 个 migration 静态校验通过。
- `git diff --check` 通过。

## 真实 DEV 记录

首次可调试 DEV 启动后，旧 Codex CLI 凭据在 Agent 层返回 HTTP 401，尚未进入 Computer Use。切换到已配置的 `gpt-5.6-sol` 后，DEV 成功创建新 Computer session：契约 `allowedApps` 为空、`actuatorLeaseId` 为空、无审批票据、无租约冲突。随后首个观察在约 3.8 秒后以 `sensitive_input_blocked` 结束。

通过 AppKit 读取当前前台应用，确认当时及复核时均为 `loginwindow (com.apple.loginwindow)`，不是哔哩哔哩或 SparkWork 普通窗口。因此这次失败属于系统安全桌面边界，不是本轮治理链残留。解锁后必须重新启动最新 DEV 并再次执行原始任务；只有哔哩哔哩客户端内可见 `comfyui 教程` 搜索结果，才可把规格与计划状态改为「已落地」。
