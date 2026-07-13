# 桌面端交互无阻塞与凭据访问治理方案

> 状态: 已落地 | 最后核对: 2026-07-13

## 目标

消除新建会话、发送消息、置顶会话、保存 Provider/模型配置时的可感知卡顿，并将 macOS Keychain 访问收敛为“安全存储、单次加载、进程内复用、显式失效”。

验收指标：

- 新建、置顶、归档、Provider 配置保存的界面反馈不超过一帧，IPC P95 小于 100ms。
- `session:list` P95 小于 50ms，不再扫描 `agent_events` 计算消息数。
- 发送消息在持久化接单后 100ms 内返回，模型运行环境在后台准备。
- Electron 主进程单次事件循环阻塞不超过 50ms。
- 统一 IPC 入口只采样通道名、耗时和结果；每通道最多保留 200 个内存样本，不采集请求/响应载荷。
- 已加载的 Provider/连接器凭据在应用本次生命周期内不重复读取 Keychain。
- 仅修改模型、端点等非密钥字段时，不读取或写入 Keychain。
- 密钥只存在 OS 安全存储和主进程内存中，不进入 Renderer 持久化、SQLite 明文或日志。

## 已确认根因

1. `session:list` 对当前列表中的 Session 执行 `agent_events` 全事件聚合。现有用户库约 208 万行事件，其中约 170 万行是 `agent_thinking`，同步聚合约耗时 3.8 至 4.2 秒。
2. 新建、置顶、Provider 配置变更都会触发 Renderer 全量 `refreshData()`，因此被同一条慢查询拖住。
3. 原交互路径 `session:send-turn` 在返回前同步等待 Provider、记忆检索、Embedding、项目上下文、工作区扫描、MCP 和 SDK 准备，实测约 0.9 至 10 秒。
4. Provider 编辑页打开时自动把 Keychain 明文密钥回显到 Renderer；随后即使只修改模型配置，保存请求仍携带原密钥并再次写入 Keychain。
5. Provider/连接器凭据已有 macOS 集中 Vault、单飞加载和进程内缓存，但自动回显和无变化重写绕过了“只在必要时访问”的设计目标。
6. 原统一 IPC 调试日志会在主线程递归复制请求对象；大消息/附件会增加同步开销，并可能把用户内容片段写入本地日志。

## 凭据处理基线

采用主流桌面 Agent 的共同安全模型：OS 安全存储负责跨重启持久化，应用进程负责本次生命周期内复用，仅在首次加载、真实轮换、登出/删除或认证失败时访问或失效。

- Codex 官方文档说明登录凭据会在本地缓存并复用，可选择 OS keyring：<https://learn.chatgpt.com/docs/auth#login-caching>
- Claude Code 官方文档说明 macOS 凭据保存在加密 Keychain；外部凭据 helper 默认使用 TTL，并在 401 时刷新：<https://code.claude.com/docs/en/iam#credential-management>
- Apple 建议常规认证路径从 Keychain 恢复凭据，避免反复打扰用户：<https://developer.apple.com/documentation/security/using-the-keychain-to-manage-user-secrets>
- Apple 说明“始终允许”可避免同一受信任应用后续重复授权：<https://support.apple.com/guide/mac-help/allow-apps-to-access-your-keychain-kychn002/mac>

上述产品没有公开桌面端的具体内存实现，本方案只确认安全模型一致，不假定其私有实现细节。

## 设计

### 1. Keychain 访问治理

- 保留 `packages/shared/src/keystore` 作为 Provider/连接器凭据唯一入口。
- macOS 只读取一个 `credential-vault-v1`，并通过 Promise 单飞避免并发重复读取。
- Vault 加载后在主进程内存中复用至进程退出；不设置会在正常使用中反复触发的短 TTL。
- Provider 编辑页不自动读取或展示已保存明文，只显示“已保存，留空不更新”。用户输入新值才视为轮换。
- 相同密钥写入必须幂等，不调用 `keytar.setPassword`。
- 更新、删除、登出后同步更新或清除内存缓存；401 仅失效对应的可刷新认证凭据，不清空全部 Provider Vault。
- 不把密钥复制到 Renderer store、localStorage 或 SQLite。
- macOS 安装包保持稳定签名、bundle id 和安装路径；签名变化造成的系统 ACL 授权不能靠缓存跨进程规避。

### 2. 会话列表增量统计

- 将当前含义混杂的 `messageCount` 拆为 `turnCount` 和 `logicalMessageCount`。
- 消息持久化时事务内更新统计，`session:list` 直接读取，禁止扫描事件表。
- 新建、置顶、归档使用服务端返回的 Session DTO 局部更新 Renderer store。

### 3. 事件分级存储

- 用户消息、完整助手消息、工具调用、文件变更和终态属于持久事件。
- `assistant_message`、`agent_thinking`、`team_member_message`、`subagent_message` 的 delta 只实时发布，不逐 token 追加 SQLite。
- 完整消息、工具结果和终态继续持久化，历史回放不依赖 append-only delta。
- 既有 delta 在后台空闲期分批清理，不在启动迁移或前台交互中执行大事务/VACUUM。

### 4. Turn 持久化接单

- 新增 `session:submit-turn`，先持久化包含消息和运行参数的 Turn request，再立即返回 `accepted`；用户消息在该 Turn 后台起跑时进入统一事件序列，启动失败也会补写用户消息和失败终态。
- `SessionService` 内的每 Session 持久队列串行消费 `accepted/queued` Turn；`startingSessions` 覆盖异步预检窗口，避免快速连续发送并发启动，也让客户端在预检阶段持续显示“执行中”。
- 工作区路径准备与持久化接单并行，接单不等待文件系统；队列在准备任务 settled 后后台起跑。
- Turn request 保存运行参数，支持状态迁移、取消、失败记录及进程重启恢复；重启时未起跑的 `accepted` 请求重新入队，已进入执行的 `running` 请求标记为中断失败，避免重复外部副作用。
- Turn request 进入完成、失败或取消终态时原子清空载荷，仅保留状态与错误元数据；终态元数据保留 30 天后由后台 Worker 分批删除。
- 旧 `sendTurn()` 暂时保留给定时任务、远程消息和 Goal 流程，避免改变其同步语义。

### 5. 主进程隔离边界

- 历史高频 delta 清理由独立 Worker Thread 使用独立 SQLite/WAL 连接分批执行，并在批次间让出 Worker 事件循环。
- Provider CLI 探测使用 5 分钟缓存与并发单飞，健康检查可显式强制刷新，避免列表刷新反复拉起 login shell。
- Agent runtime 的重准备工作位于 `accepted` IPC 边界之后；客户端不再等待它完成。SDK/CLI 自身仍沿用既有子进程与异步执行模型。
- 不为追求形式上的“全部进 Worker”复制 SessionService 状态机和凭据到另一线程；当前隔离只移动已确认的批量维护负载，降低跨线程状态一致性和密钥扩散风险。

### 6. 性能可观测性

- 在 `typedIpcHandle` 统一入口以单调时钟统计主进程 Handler 耗时，覆盖 Schema 校验与业务 Handler；Renderer 到主进程的结构化克隆与调度延迟不在该指标内。
- 新建、列表、置顶/更新、发送接单、Provider/模型保存使用 50ms/100ms 明确预算，超预算立即写入不含业务载荷的告警。
- 每 50 次 IPC 汇总最近活跃通道，输出有界的滚动 P50、P95、最大值、错误数；每通道最多保留 200 个内存样本，单次报告最多 10 个通道。
- IPC 日志不再遍历或打印请求/响应载荷，避免观测本身阻塞主线程或泄露消息、附件与凭据。

## 分批交付

1. Provider 自动回显/重复写入修复及缓存回归测试。
2. 会话统计增量化和 Renderer 局部更新，覆盖新建、置顶、归档、配置保存。
3. 流式事件分级持久化及历史 delta 后台清理。
4. 持久化 Turn 接单队列与后台启动协调器。
5. Runtime/数据库 Worker 隔离和性能回归。

每批独立提交、独立回滚。修改符号前执行 GitNexus impact；提交前执行 `gitnexus detect-changes` 并更新索引。

## 当前实施进度

- [x] Provider 编辑不再自动读取 Keychain 明文到 Renderer。
- [x] 相同凭据写入幂等化，并发读取/写入使用单飞缓存。
- [x] Claude/Codex CLI 可用性探测改为 5 分钟 TTL 与并发单飞。
- [x] 会话列表直接读取持久化 `turnCount/logicalMessageCount`，不再聚合事件表。
- [x] 会话置顶使用乐观局部更新、服务端结果校准和失败回滚。
- [x] 新建、归档、重命名和 Provider/Agent 配置事件改为领域补丁或定向刷新，移除交互热路径全量刷新。
- [x] 用 migration 052 的持久化统计字段与触发器替代事件聚合查询。
- [x] 流式事件分级存储，并由独立 Worker 分批清理四类历史 delta。
- [x] migration 053、持久化 Turn 接单、按 Session 串行后台启动与重启恢复。
- [x] 工作区准备移出接单等待，批量数据库维护移入 Worker；保留现有 runtime 子进程边界。
- [x] 终态 Turn 请求原子清空载荷，并由后台 Worker 按 30 天保留期批量回收元数据。
- [x] 统一 IPC 有界滚动指标、关键交互预算告警及零载荷日志。

## 落地验证

- `@spark/storage` Repository 回归通过：34/34；完整 storage 包回归为 176/176。
- IPC 有界采样、预算告警和报告上限定向回归通过：3/3。
- 持久化接单、同步兼容、快速连续发送串行化和工作区延迟准备用例通过。
- 事件分级、Provider 缓存、Keychain Vault、协议 Schema 和 Renderer event mapper 定向回归通过。
- Electron Vite 生产构建通过，并产出独立 `background-maintenance-worker` 主进程构建入口。
- Session runtime 专项链路为 36/38，持久接单、快速连续发送串行化和工作区延迟准备用例均通过；失败仍为仓库既有的 `/validate --repair`、`/usage` 两项基线。
- 全仓库现存的 FFmpeg exact-optional 类型错误、`main/ipc/index.ts` 一处可空值错误和部分 Renderer 历史 mock 不在本专项改动链路内；专项涉及文件的定向类型、Lint、测试与构建均已验证。
- P95 指标仍需在带真实历史库的签名安装包中持续采样；本次不把单元测试或构建耗时伪装成生产性能数据。

## 风险与兼容

- 共享 `getSecret/setSecret` 位于 CRITICAL 凭据路径，优先通过调用端避免无效访问；共享层只接受行为收窄且有完整回归测试的修改。
- `startTurn` 是 CRITICAL 执行入口，不直接改为 fire-and-forget，而是新增持久化接单边界。
- Provider 自动回显取消后，用户仍可通过输入新密钥完成轮换，但不会再把旧密钥暴露到 Renderer。
- Keychain 被锁定、用户选择“允许一次”、应用签名或路径变化时，macOS 仍可能在下次进程启动询问；应用内存缓存只承诺同一次运行期间不重复读取。
