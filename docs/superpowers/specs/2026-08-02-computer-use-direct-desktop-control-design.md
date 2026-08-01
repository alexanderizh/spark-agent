# Computer Use 直接桌面控制设计

> 状态: 实施中 | 最后核对: 2026-08-02

## 目标

Computer Use 一经用户发起，即可在所有会话权限模式下直接、快速、完整地操作整台桌面。应用白名单、逐动作审批、持久执行器租约及其 TTL/续租/残留记录不得再成为任务失败点。新桌面任务默认抢占旧任务，旧任务立即取消并释放输入、捕获和控制标记。

任务成功必须由可见验收证据证明。打开应用、聚焦窗口或输入搜索词本身都不能替代“目标应用内已出现搜索结果”等最终验收条件。

## 已确认的产品语义

1. Computer Use 与会话权限模式解耦。`claude-ask`、`claude-auto`、`claude-plan`、`claude-bypass`、`codex-*` 等模式均拥有相同的桌面操作能力。
2. 不生成、不检查、不展示应用白名单。旧 `allowedApps` 字段仅保留协议和历史数据兼容，运行时忽略其内容。
3. 不再为 L2/L3 桌面动作弹逐动作审批，也不因敏感文本、高影响动作或无人值守状态要求 handoff。用户启动桌面任务即是对该任务的完整操作授权。
4. 显式 `targetWindowId` 仍限制任务只操作该窗口。这是用户指定的任务范围，不是应用白名单或权限治理。
5. 新任务自动取消当前执行中的旧桌面任务并立即接管，不排队，也不向 Agent 暴露租约冲突。
6. 系统屏幕录制、辅助功能和输入权限继续保留；Native Host 签名、哈希、架构、版本与协议校验继续保留。它们只在连接或环境变化时校验，并使用现有缓存，不参与逐动作授权。
7. Native Host 或模型输出确实无效时返回准确错误，例如 `decision_model_error`、`native_host_incompatible`、`permission_denied`，不得折叠成 `action_not_allowed` 或“未授权”。

## 方案选择

### 方案 A：保留持久租约并继续修补 TTL（不采用）

优点是保留现有数据库模型；缺点是 TTL、续租、残留状态和旧会话回收继续进入执行热路径，已多次造成零成功率故障。它不满足“内部协调不得成为用户可见阻断”的目标。

### 方案 B：删除所有互斥（不采用）

优点是实现表面最简单；缺点是两个任务可同时抢鼠标、键盘和前台窗口，会产生错误点击、组合键残留和更低成功率。

### 方案 C：主进程内存单执行器 + 新任务抢占（采用）

主进程只维护一个当前桌面任务句柄。新任务启动时同步取消旧任务，等待 Native Host 完成输入释放与捕获清理，然后把执行权交给新任务。协调状态不持久化，不设 TTL，不需要心跳，不产生 `actuator_lease_conflict`，也不受权限模式影响。

## 架构

### 1. `ComputerDesktopExecutionCoordinator`

新增一个小型主进程服务，职责只有：

- 记录当前 active computer session；
- `claim(newSessionId)` 时调用注入的 `stopSession(oldSessionId)`；
- 等待旧会话完成 Broker/Native Host 清理后再返回；
- 同一会话重复 claim 幂等；
- `release(sessionId)` 只在持有者匹配时清空；
- 应用退出时取消当前任务。

协调器不接触数据库，不创建租约 ID，不计时，不判断权限模式，也不参与动作策略。

### 2. 会话与动作信封兼容

协议中的 `actuatorLeaseId` 和数据库表暂不物理删除，避免破坏历史数据与跨版本读取；新会话将其保持为 `null`。动作信封继续保留兼容字段，但 Broker 不再用它做执行授权。后续数据库清理可作为独立迁移，不进入本次成功率改造。

`ComputerSessionManager` 保留会话生命周期、AbortSignal、暂停/取消/完成与目标绑定能力；删除 Controller/IPC 对 `acquireLease`、`heartbeatLease`、`releaseLease` 的运行时依赖。旧租约方法只作为兼容 API，生产链不再调用。

### 3. 直接放行策略

`ComputerPolicyService` 仅保留下列执行一致性检查：

- 当前观察应用必须与动作目标应用一致；
- 显式窗口绑定必须匹配；
- 动作类型和 payload 必须通过协议 Schema；
- task runtime/step 上限继续防止无限循环。

应用域名、应用身份、数据类别、风险级别、用户是否在场和 `permissionMode` 不再决定 allow/approval/handoff。合法动作统一返回 `allow`，风险级别仅用于审计展示，不参与阻断。

`ComputerTaskOperator` 不再调用 `requestApproval`，Broker 不再创建或消费 approval ticket。现有审批存储和历史事件保留兼容，但新任务不生成审批记录。

### 4. 抢占与清理顺序

新任务启动顺序：

1. 创建新 session，状态为 `preflighting`；
2. coordinator `claim(newSessionId)`；
3. 若有旧 session，调用 Broker/Controller stop；
4. 旧 session AbortSignal 触发 operator 退出；
5. Backend 下发 `cancel_session`，Native Host 释放按键、停止持续捕获、清除目标绑定；
6. 新 session 进入 observing 并启动 operator。

任何阶段失败时，新 session 必须进入准确终态，coordinator 必须释放持有权。不得出现“operator 已失败但 session 仍 running”。

### 5. 模型动作兼容与错误

保留当前未提交的模型动作改进：完整动作 JSON 结构、平台提示、常见按键别名归一化，以及 `decision_model_error`。Parser 只兼容语义等价别名，不放行畸形坐标、未知动作或无法安全解释的 payload。

Operator 将原始 `ComputerUseBrokerError.code` 写入 session 终态；Controller 返回 acquire/claim 后的最新 session，不再以旧对象中的 `actuatorLeaseId: null` 推断执行失败。

## 测试与验收

### 自动化

- coordinator：无旧任务、新任务抢占旧任务、重复 claim、旧任务清理失败、新任务终态释放；
- Controller/IPC：所有权限模式均直接启动；启动第二任务会停止第一任务；无 acquire/heartbeat/release lease 调用；
- Policy/Broker/Operator：L0-L4、敏感输入、unattended、外部写入均直接执行，不创建审批或 handoff；显式窗口和观察目标不一致仍拒绝；
- 模型解析：`WIN/CMD/COMMAND` 归一化，错误输出返回 `decision_model_error`；
- 清理：抢占、手动停止、成功、失败均调用 Native Host `cancel_session` 并清除控制标记；
- 全量 Computer Use 测试、desktop/protocol typecheck、production build 通过。

### 真实 DEV 验收

必须在本仓库新构建并启动的 DEV Electron 实例中执行：

> 打开我电脑上的哔哩哔哩应用，然后搜索 comfyui 教程。只有在应用内可见搜索结果后才报告完成。

验收证据：

- 任务契约中 `allowedApps` 为空；
- 无审批弹窗、无 handoff、无 `actuator_lease_conflict`；
- 哔哩哔哩客户端成为实际控制目标，Spark 自身不残留控制标记；
- 应用内可见 `comfyui 教程` 搜索结果；
- 新任务抢占旧任务后旧任务状态为 canceled，输入和捕获均已释放；
- 若失败，继续修复，不能用浏览器 fallback 或“已打开应用”冒充成功。

## 非目标

- 不绕过 macOS/Windows 系统隐私权限；
- 不移除 Native Host 签名、哈希、架构、版本和 wire 协议校验；
- 不在本次物理删除历史租约/审批数据库表或破坏旧会话反序列化；
- 不允许两个桌面任务同时注入输入。

## 回滚

本改造以独立提交落地。回滚时恢复 Controller/IPC 的租约调用、Policy 审批分支和旧 Presenter 接线即可；兼容字段与数据库表始终保留，因此无需数据回滚。
