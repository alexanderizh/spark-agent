# Computer Use V2 Phase 7 · 灰度、自动回退与去轮询审查

审查日期：2026-08-01

## 结论

Phase 7 自主代码范围已完成：V2 flags 统一注册、运行期单功能回退、Host Supervisor 基础路径回退、action batch 即时关闭和 Agent 事件驱动等待均已接线。自动回退不会关闭整个 Computer Use，也不会绕过 Broker。5%/25%/100% 跨版本放量和连续两个稳定版本后删除旧路径依赖发布运营数据，保留为发布签收项。

## 三遍审查

### 第一遍：功能与调用链

- `ComputerUseV2FlagStore` 统一八类计划 flag 和增量树兼容项；既有三个 wrapper 保持签名，调用方无需迁移。
- `ComputerUseV2RolloutController` 对 Host session、artifact check、action outcome、takeover latency、capture budget 使用最多 2048 个样本的滑动窗口。
- Host/安装异常只回退 Supervisor；动作错误率和接管 P99 只回退 batch；持续捕获超预算只回退 persistent capture。
- `wait_for_completion` 使用 `ComputerSessionManager.subscribeStatus()`，在 completed/failed/canceled/paused/waiting_approval/handoff_required 返回，最长等待 300 秒；`get_status` 保留为即时快照。

### 第二遍：安全、竞态与降级

- 回退前有最小样本门槛，单次抖动不会关闭功能；阈值严格使用计划中的 0.5% Host crash、0.1% install failure 和 500 ms takeover P99。
- Supervisor 回退先让当前 backend 停用 supervisor、清除旧 observation 并释放持久连接；精确 target binding 保留，下一请求走基础连接并强制重新观察。
- actionBatch wrapper 每轮读取统一 store，运行期回退在下一决策生效；当前 Broker/Native Host 动作仍受 AbortSignal 和逐步新鲜度检查。
- wait 工具先校验会话归属，订阅后再次读状态以封闭“读取与订阅之间完成”的竞态；超时返回当前状态和 `timedOut`，不伪造失败或完成。
- Bridge 修复了 `diagnose_native_host` schema 已声明但 allowlist 漏放行，以及 `bind_target` 已实现但 Provider allowedTools 漏挂载的问题。

### 第三遍：五轴质量

- 正确性：覆盖默认值、env 兼容、单 flag 回退、P99、Supervisor→基础路径、事件等待、权限映射和 MCP 工具暴露。
- 可读性：flag 解析、采样/阈值和业务接线分为三个模块；无新增依赖。
- 架构：Rollout Controller 只发布 flag rollback，不直接操作 Broker；Backend 自己决定如何安全回退连接所有权。
- 安全：未知/低层工具仍永久拒绝；诊断和等待映射为只读权限；bind target 继续走暂停、所有权和强身份校验。
- 性能：固定上限样本、无数据库写、无新轮询；状态等待由现有事件集驱动。

## 验证证据

- Phase 7 聚焦 Vitest：11 文件 125 项通过；Computer Use + permission/prompt 全量 48 文件 356 项通过（含 MCP 回环环境）。
- `npx tsc -p packages/agent-runtime/tsconfig.json --noEmit`：exit 0。
- `npx tsc -p apps/desktop/tsconfig.node.json --noEmit`：exit 0。
- `pnpm --dir apps/desktop build`：main/preload/renderer 全部成功。
- `pnpm --dir apps/desktop dev`：数据库 64 个迁移、全部 Computer Use IPC、MCP 初始化、Renderer 请求与应用初始化成功；验证后正常停止冒烟进程。OpenRouter MCP 返回 HTML 是既有外部配置错误，不影响应用启动或 Computer Use。
- `git diff --check`：通过；提交使用精确 pathspec 排除并行 Canvas/depth 改动。

## 发布签收

Beta 放量系统按内部开发包→内部签名包→5%→25%→100%执行。每次放量导出 flag snapshot、样本数、触发阈值与 rollback event；连续两个稳定版本后才允许删除旧单动作/轮询兼容路径。
