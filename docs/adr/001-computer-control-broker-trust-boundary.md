# ADR-001：Computer Control Broker 作为唯一电脑操作安全边界

> 决策状态: 已接受 | 日期: 2026-07-28

## 背景

Spark Agent 需要让多个模型 Provider、Workflow、MCP、远程设备和 Renderer 共同使用 Computer Use。如果每个调用方直接访问原生截图、Accessibility 或键鼠能力，权限、审批、停止、审计和验收会产生多套实现，任何一个入口都可能绕过其余入口的安全规则。

项目已有 `BrowserBridgeServer`、SDK allowed tools、通用 `PermissionService` 和远程 capability，但这些机制都不能单独承担真实桌面操作的安全边界：浏览器桥包含本地 HTTP/SID/eval 语义，allowed tools 可能绕过审批回调，通用 MCP 权限缺少动作和目标粒度，远程配对也不等于桌面授权。

## 决策

在 Electron 主进程内实现 `ComputerControlBroker`，并把它定义为唯一可以向 Native Host 派发电脑写动作的组件。

所有来源必须经过同一链路：

```text
User / Runtime / Workflow / MCP / Remote / Renderer
  -> ComputerControlBroker
  -> task contract + app/domain scope
  -> actuator lease
  -> frame/tree/app/window freshness
  -> policy + one-time approval ticket
  -> signed Native Host over inherited pipe
  -> after observation + audit + verification
```

具体约束：

- Renderer、MCP 子进程、Provider SDK 和 Remote Gateway 不持有 Native Host pipe。
- Native Host 不监听端口，不自行决定用户授权，不持久化审批票据。
- Broker 对每个动作重新校验 lease、观察版本、应用、窗口、策略和 ticket。
- 模型仅提出规范化动作；模型 Provider 的原生 computer tool 也必须转换到 Spark action envelope。
- Stop/Kill Switch 由 Broker 撤销 lease 并清空动作队列，不依赖模型合作。
- Snapshot Vault、审计事件和 Verification Engine 通过 Broker 的关联 ID 形成证据链。

## 原因

- 单一安全边界能让本地、Workflow 和远程入口共享相同的 fail-closed 行为。
- 主进程适合持有系统权限状态、子进程 pipe、钥匙串密钥和 Electron IPC 调用方身份。
- Provider 与平台解耦后可以增加模型适配器或 Native Host 实现，而不复制安全逻辑。
- lease、frame freshness 和 ticket 消费需要统一的并发与事务控制，分散实现无法可靠防止 TOCTOU。

## 被否决方案

### Provider/Agent Runtime 直接控制 Native Host

否决。Runtime 可能运行第三方模型、MCP 或不同 SDK，且无法可靠识别 Electron Renderer、远程设备和本地权限状态。

### Renderer 直接调用系统 API

否决。Renderer 攻击面更大，也无法成为签名 sidecar、钥匙串和全局租约的持有者。

### 复用 BrowserBridgeServer

否决。其 SID、本地 HTTP、CORS 和页面 eval/inject 适用于受管浏览器调试，不满足真实桌面最小能力与 pipe 隔离要求。

### 仅依赖 MCP 权限或 SDK allowed tools

否决。工具名授权不能表达观察版本、目标窗口、数据类别、一次性 ticket 和跨入口全局租约。

## 结果

正面结果：

- 策略、审批、停止、远程控制和审计只有一套实现；
- OpenAI、Claude 和通用视觉模型可以共享协议与平台后端；
- Native Host 可按平台独立发布，同时保持相同的 fail-closed contract；
- Verification Engine 能可靠引用动作前后观察和审批记录。

代价：

- 主进程 Broker 是关键组件，需要严格模块拆分、故障恢复和大量并发测试；
- 所有桌面动作多一次 IPC/wire 往返；
- Provider 批量动作必须逐项进入 Broker，不能直接追求最低延迟；
- 协议版本、Native Host 和桌面应用需要联合兼容测试。

## 实施约束

- `apps/desktop/src/main/ipc/index.ts` 只注册独立 handler，不放 Broker 业务逻辑。
- `session.service.ts` 只通过 Provider 接口调用 Computer Use，不持有 Native Host。
- 所有 Native wire schema 放在 `packages/protocol/src/computer-use/` 并拒绝未知字段。
- 改变 Broker 信任边界、允许新的直接执行入口或放宽 L4 规则时，必须新增 ADR 替代本决策。
