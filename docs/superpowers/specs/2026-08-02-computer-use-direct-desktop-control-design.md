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
8. Agent 在用户明确命名应用时应把精确显示名或 bundle id 作为 `targetApp` 交给 `start_task`。macOS 主进程先复用并拉起已有应用，或通过固定 `/usr/bin/open` 参数直接启动，再以真实窗口清单完成强身份绑定；不再让视觉模型操作 Spotlight 来承担应用启动。
9. AX 语义动作在 Electron/自绘界面返回 `action_noop` 后，下一轮模型输入必须携带失败码和动作类型，并切换到截图坐标路径，禁止原样重复同一失败动作。

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

### 5. Codex 风格的应用直达与恢复

`start_task.targetApp` 是可选的明确目标，不从不可信页面文字推断。macOS 解析器只调用固定绝对路径 `/usr/bin/open`，参数以数组传递且不经过 shell：显示名使用 `-a`，bundle id 使用 `-b`。启动后以 100 ms 间隔等待最多 8 秒，只有窗口清单中的 app name、bundle id 或稳定 app id 精确匹配时才绑定。无法解析时回到既有前台桌面导航，不伪造启动成功。

Native Host supervisor 仍限制单任务内的自动重启次数，但任务结束时必须复位预算。取消一个已经断连的任务不得为了清理而重新启动 Host；没有活动连接时只清理本地 observation/target 状态并复位 supervisor，使下一任务可以重新握手。

Operator 把最近一次可恢复动作失败以 `{code, actionType}` 注入下一次决策。对 Electron 常见的 `invoke_element|set_value + action_noop`，决策提示要求立即改用截图坐标点击与普通输入，避免连续消耗 noop 预算。

### 6. 模型动作兼容与错误

保留当前未提交的模型动作改进：完整动作 JSON 结构、平台提示、常见按键别名归一化，以及 `decision_model_error`。Parser 只兼容语义等价别名，不放行畸形坐标、未知动作或无法安全解释的 payload。

Operator 将原始 `ComputerUseBrokerError.code` 写入 session 终态；Controller 返回 acquire/claim 后的最新 session，不再以旧对象中的 `actuatorLeaseId: null` 推断执行失败。

### 7. 可组合的桌面状态与应用直达接口

Agent 不应为了查询应用、窗口或屏幕状态而创建长生命周期任务。MCP 桥提供五个短调用：

- `list_apps`：按 `running | installed | all` 返回运行中、已安装或合并应用；运行状态来自 Native Host 窗口清单，macOS 已安装目录来自固定 Spotlight 元数据查询并缓存 5 分钟；目录查询失败时自动降级为空，不阻断运行中应用结果。
- `list_windows`：按显示名、bundle id 或稳定 app id 精确筛选窗口，可选择包含最小化窗口。
- `get_screen_state`：一次返回前台窗口、显示器、运行中应用及窗口数量，不创建 Computer session。
- `get_app_state`：按应用或窗口直达，返回窗口元数据和 Native Host 的完整 AX/视觉观察；聊天快照是独立的可选增强，其失败不得丢弃已经取得的状态。
- `open_app`：只负责启动或拉起应用并返回真实窗口状态，不读取完整 AX 树，不使用 Spotlight 键盘导航。

当已有桌面任务占用共享 Native Host 连接时，`get_app_state` 使用一次性观察连接，完成后立即关闭，不能修改活动任务的目标绑定、增量树版本或 supervisor 状态。模型应优先调用满足需求的最小接口：已知应用直接 `get_app_state`/`open_app`，只有目标未知时才枚举应用。

### 8. 单步失败后的有界替代策略

单个动作失败不能直接结束任务。Operator 记录失败码、动作类型、连续失败次数和已经失败的交互策略，并在重新获取完整状态后要求模型切换路径：AX 元素操作、截图坐标、键盘导航、窗口聚焦、原生应用命令和有界等待之间按实际可用性降级。连续 noop 达到任务阈值时不再立刻失败，而是强制完整观察并继续替代策略；总步骤数和总运行时间仍作为最终循环边界。

观察失败使用指数退避和 Host 重连预算；截图证据读取失败时重新观察，仍不可用则以 AX 状态继续无图决策；验收用窗口清单或验收记录存储失败时，使用当前观察和内存验收结果继续。只有取消、真实用户接管、系统安全桌面、系统权限缺失、不可信 Host、任务总步骤/时间耗尽等无法安全替代的边界才能终止任务。

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
