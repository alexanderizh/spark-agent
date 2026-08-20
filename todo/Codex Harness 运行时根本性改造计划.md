# Codex Harness 运行时根本性改造计划

> 状态: 实施中 | 最后核对: 2026-08-21

## 1. 结论与边界

Spark 已经使用官方 `codex app-server` 作为 Agent harness。本计划不重写 Agent loop、
工具执行、沙箱、上下文压缩或审批协议；改造对象是 Spark 自研的 App Server 宿主层：

- 将“每个 turn 启动并销毁一个进程”改成“受监督的长生命周期 runtime”。
- 将单一 active-turn 回调改成按 request / thread / turn 归属的可靠路由。
- 持久化 Spark session 与真实 Codex thread 的绑定，真正使用 native resume。
- 保持 SessionService、事件库、队列、权限 UI 和跨引擎协议的产品权威地位。

官方依据：OpenAI 2026-08-19《Codex as a platform》明确把 App Server 定位为产品内嵌层，
支持保持会话、流式事件、中断、工具与审批；产品继续拥有业务状态和用户体验。

## 2. 已完成基线

- [x] P0：用户气泡与引擎准备解耦，`clientMessageId` 端到端贯穿并去重。
- [x] P0 现场验收：气泡可以及时出现。
- [x] P1：补齐 `initialize → initialized` 握手。
- [x] P1：记录 spawn、initialize、thread resume/start、turn/start、首输出分段指标。
- [x] 已确认剩余体验问题：气泡及时出现，但真实输出仍被 App Server 每轮冷启动阻塞。

## 3. 当前结构性问题

```text
每个 turn
  EngineRegistry.createExecutor()
    → new CodexAppServerExecutor()
      → spawn app-server
      → initialize / initialized
      → thread/resume 或 thread/start
      → turn/start
      → 流式执行
      → finally dispose app-server
```

这会造成四类系统性问题：

1. 每轮重复支付 spawn、协议初始化和 thread 建立成本。
2. Spark 逻辑 session id 不是真实 Codex thread id，resume 通常失败后重新 start。
3. client 回调固定绑定单个 executor，无法安全复用 transport。
4. 直接删除 `dispose()` 会产生事件串流、审批错配、取消错误和 waiter 永久挂起。

## 4. 目标架构

```text
SessionService / EngineRegistry
           │ create per-turn adapter
           ▼
CodexAppServerExecutor（只保存单 turn 映射状态）
           │ acquire(sessionId, fingerprint)
           ▼
CodexRuntimeSupervisor
  ├─ session lease map
  ├─ 并发 acquire 合并
  ├─ idle TTL / LRU / 资源上限
  ├─ crash invalidation
  └─ graceful shutdown
           │
           ▼
CodexAppServerRuntime
  ├─ CodexAppServerClient（NDJSON transport）
  ├─ CodexAppServerRouter（request/thread/turn 路由）
  ├─ thread binding
  └─ per-thread serial gate
           │
           ▼
官方 codex app-server / Codex harness
```

## 5. 不可破坏的不变量

- Spark 用户消息、队列和事件库仍是产品权威数据源。
- 同一 Spark turn 最多调用一次成功的 `turn/start`；成功后禁止自动 fallback 二次执行。
- 重复用户消息、重复 assistant 终态、跨会话事件必须为 0。
- 同一 Codex thread 同时最多一个 `turn/start`；不同 session 初期不共享 thread 或进程。
- server request 必须被当前 turn 的审批上下文处理；找不到归属时确定性 reject，不能挂起。
- transport 退出必须拒绝所有 pending request、终止所有 active route 并使 lease 失效。
- Provider、API endpoint、API key、工作区、MCP 或身份变化时不得错误复用旧绑定；可由官方
  `turn/start` 覆盖的权限/安全策略必须每轮显式下发，不能因切权限而丢失 native 上下文。
- 日志、fingerprint 和错误信息不得暴露 API key 或自定义环境中的秘密。

## 6. 分阶段实施

### P2-A：可靠 Router 地基（已实现）

- [x] 从 client 的固定单回调中抽离 `CodexAppServerRouter`。
- [x] 通知按 `threadId` / `turnId` 路由到动态注册的 turn handler。
- [x] `turn/start` 返回前到达的事件按 thread route 缓存，注册 server turn id 后有序回放。
- [x] server request 使用相同归属规则；未知归属立即 JSON-RPC reject。
- [x] transport 退出广播给全部 active route，释放所有 waiter。
- [x] client 保持 requestId pending map、NDJSON 解析和写入职责，不承载业务 turn 状态。
- [x] 补充乱序、抢跑、迟到、未知归属、退出广播和 handler 异常测试。

阶段验收：保持现有每-turn lifecycle 不变时，所有既有 App Server 测试继续通过；新 router
测试覆盖乱序与故障，不改变产品行为。

### P2-B：单 session Runtime Supervisor

- [x] 新增 `CodexAppServerRuntime`，一次完成 spawn 与 initialize。
- [x] 新增 `CodexRuntimeSupervisor`，以 Spark session 为隔离边界管理 lease。
- [x] 同一 key 的并发 acquire 合并为一个启动 Promise。
- [x] executor 完成 turn 后 release route，不销毁健康 runtime。
- [x] 默认 idle TTL 自动回收，并设置最大 runtime 数与 LRU 淘汰。
- [x] SessionService / EngineRegistry dispose 时统一关闭 supervisor。
- [x] feature flag `SPARK_CODEX_PERSISTENT_RUNTIME=1` 支持灰度与旧路径回退。
- [x] 将动态 Team / Plugin MCP HTTP bridge 与 Bearer 提升为 runtime lease 生命周期；
      turn 结束只停用 handler，TTL/LRU、崩溃、失效与 shutdown 才撤销 bearer。
- [x] 工具目录变化时轮换 bridge resource 与 runtime fingerprint；fingerprint 轮换时相同
      sidecar 可原子转移，避免新 Runtime 启动前误撤销复用凭据。

阶段验收：同一会话第二轮不再 spawn / initialize；不同会话不共享 runtime；崩溃后下一轮
可新建 runtime；冷/暖指标可区分。

### P3：真实 Codex Thread Binding

- [x] 定义 binding key + runtime/thread fingerprint → nativeThreadId 绑定记录。
- [x] 首轮 `thread/start` 后保存 App Server 返回的真实 thread id。
- [x] warm turn 直接复用 runtime 内已加载 thread，不再 resume/start。
- [x] 应用重启后用真实 id 执行 `thread/resume`，成功后更新候选顺序。
- [x] fingerprint 不兼容时创建新 binding，并通过 Spark continuity prompt 恢复必要上下文。
- [x] `thread/resume` 失败发生在 `turn/start` 前，可安全 fresh；已开始的 turn 不自动重试。
- [x] Host / mention / Team member 使用独立 identity 与 lease scope，避免串 thread 和嵌套死锁。
- [x] fresh binding 持久化失败时在 `turn/start` 前回退，避免重启后恢复到旧分支。
- [x] 权限、sandbox、网络与额外 writable roots 每次 `turn/start` 显式覆盖；这些字段从
      thread fingerprint 降级为 sticky turn 配置，切权限时保持 native thread 连续。

阶段验收：同 fingerprint 多轮 native 命中率接近 100%；重启后可恢复；配置切换不串 thread。

### P3-C：运行态权威协调

- [x] `getQueueState` 返回前协调数据库 running 与 TurnRegistry/Team dispatch 内存权威状态。
- [x] 无真实执行的 ghost running 补齐断流轮终态并恢复 idle。
- [x] `cancelTurn` 对 ghost running 返回成功收口，不再误报没有运行任务。
- [x] 活跃 running 历史会话在切换、聚焦与 15 秒低频周期内核对权威 queue；false 时清理
      session spinner 与遗留 agent status。
- [x] Codex 默认权限文案改为“按需批准”，明确工作区内安全写入不会逐次弹窗。
- [ ] 在真实开发版复测权限切换与历史 ghost running 两条现场路径。

### P3-D：Runtime 版本兼容与 Skills 预算告警

- [x] 将“已安装且兼容”的 runtime 与应用内 JS SDK 精确版本解耦；`0.144.5` 及以上完整
      runtime 在应用升级后继续可用。
- [x] 保持云端安装 artifact 对当前 SDK 的精确兼容选择，新版本只作为可选更新，不自动替换。
- [x] Codex runtime 自动更新缺省关闭；只在用户显式开启后自动更新，并持久化该偏好。
- [x] 对齐官方 Skills 渐进披露语义，兼容新版无 `2%` 字样的 context budget warning。
- [x] SDK、CLI、App Server 与 renderer 历史回放统一避免把该 warning 渲染为执行失败。
- [ ] 在保留旧 runtime 的安装环境中做一次应用升级现场验收，确认会话可直接执行且完整性页
      显示“可更新”而不是“未安装”。

### P4：资源治理与灰度

- [x] 提供按需脱敏诊断：runtime PID、RSS、句柄、loaded thread、进程/lease 数量，以及
      cold/warm、thread mode、TTL/LRU、crash、失效、启动失败与手动重启计数。
- [x] Platform Bridge / MCP 提供安全手动重启入口；只回收 idle Runtime，active turn 返回
      busy 摘要并保持运行。对外 lease id 均为不可逆摘要，不返回 token、env 或 session id。
- [ ] 在真实开发版采集 RSS、warm/resume 命中率与回收数据，形成资源基线和告警阈值。
- [ ] 先灰度单 session 独占；达到资源基线后再评估受控 fingerprint 进程共享。
- [ ] 对共享进程设置 thread 隔离、全局并发上限和公平调度。
- [ ] 在 Settings / 完整性界面产品化诊断摘要与手动重启按钮；当前入口为 Platform MCP。

### P5：Harness 能力扩展

- [ ] 将既有 `steer` / `compact` 接到明确产品语义。
- [ ] 评估并接入 fork、review、结构化用户提问、本地图片和动态模型能力。
- [ ] 协议类型改为由锁定版本的官方 schema 生成并在 CI 检查漂移。

## 7. Runtime Fingerprint

fingerprint 只保存不可逆摘要，并按真实生命周期分层：

- `runtimeFingerprint`：可执行文件、启动参数、Provider/custom/MCP 环境；API key 与动态
  bridge token 只参与摘要，不保存或输出明文。
- `threadFingerprint`：cwd、model、Provider wire config、MCP config 等不能安全按 turn 替换的
  thread 配置，以及由 binding key 表达的 Agent/Host/Member 身份隔离。
- `turn/start` sticky 配置：approval policy、reviewer、sandbox、network、额外可写目录；每轮
  显式下发，不进入 thread fingerprint。

这样既不会复用过期授权或错误 Provider/MCP，也不会把官方可按 turn 调整的权限误判成必须
重启进程或新建 thread。

## 8. 生命周期与失败语义

```text
idle ── acquire ──> starting ── ready ── attach route ── running
 ▲                    │           │                         │
 │                    └─ fail ───> dead <──── transport exit┘
 └──── TTL/LRU release <────────── healthy turn complete
```

- `turn/start` 前失败：允许回退旧载具，但必须证明官方 turn 尚未开始。
- `turn/start` 已返回或观察到 `turn/started`：禁止自动回退，错误在原 turn 内终结。
- cancel 在 server turn id 返回前：使 runtime 失效并终止 transport，避免未知 turn 留在后台。
- cancel 在 id 已知后：发送 `turn/interrupt`；watchdog 超时再使 runtime 失效。
- 迟到通知只允许进入仍注册的 route；route 释放后丢弃并记录受限诊断。

## 9. 测试矩阵

### Transport / Router

- request 响应乱序、超时、RPC error、进程退出批量 reject。
- `turn/started` / delta 在 `turn/start` response 前到达。
- 两个 route 的事件不可串流；未知 thread/turn 不落入默认 route。
- server request 在 active route、未知 route、handler 抛错和 handler 超时下均确定性结束。

### Supervisor

- acquire 合并、warm reuse、fingerprint rotate、TTL、LRU、dispose。
- 启动失败不污染 cache；运行时 crash 原子失效；下一轮可重建。
- SessionService shutdown 不遗留子进程或 pending waiter。

### 产品回归

- 普通多轮、排队、取消、审批、失败、长会话、团队 member、定时任务。
- Provider / model / MCP / workspace / permission 切换。
- `clientMessageId` 去重与 optimistic 气泡不受 runtime 改造影响。

## 10. 指标与发布门槛

- 点击发送 → 用户气泡 DOM：p95 ≤ 100ms（P0 已现场通过）。
- warm runtime acquire：p95 ≤ 20ms。
- warm acquire + `turn/start`：p95 ≤ 300ms。
- cold start、warm start、native resume 分桶记录，不能混算。
- duplicate turn / duplicate message / cross-session event：0。
- runtime crash rate、restart success、resume hit、TTL eviction、RSS 均可观察。

发布采用默认关闭的 feature flag：内部开发版 → 单会话白名单 → 小比例灰度 → 默认开启。
每阶段可退回旧每-turn lifecycle，回滚不删除 Spark 事件或 native binding 数据。

## 11. 当前实施记录

- 2026-08-21：P0/P1 现场验收完成，气泡即时出现，真实输出仍明显等待。
- 2026-08-21：GitNexus impact 显示 Client 3 个直接依赖、Executor 2 个直接依赖，
  共同影响一条 App Server `executeTurn` 流程，图谱风险 LOW。
- 2026-08-21：开始 P2-A，先建立可独立测试的 router，不在同一步骤直接启用进程复用。
- 2026-08-21：P2-A/P2-B 代码完成，默认由 feature flag 关闭；同 session 两个
  per-turn executor 的 harness 测试确认仅 spawn/initialize 一次，第二轮为 warm。
- 2026-08-21：修复 spawn error 未标记 exited 导致 fallback 额外等待 2 秒的问题；
  executor 契约测试耗时从约 3.4 秒降到约 1.46 秒。
- 2026-08-21：安全复核确认动态 MCP Bearer token 不能从 fingerprint 中移除；需先把
  bridge handle 生命周期与 runtime lease 对齐，否则复用旧进程会使用过期授权。
- 2026-08-21：P3 代码完成。session metadata 保存真实 thread 与双 fingerprint；warm turn
  直接 loaded，重启后 exact-match resume，失配或 resume 失败使用 Spark continuity fresh。
- 2026-08-21：两轮源码复核修复 Host/Team lease 互锁、嵌套 lifecycle 串流、fresh binding
  持久化失败继续执行及 Host key 未隔离 Agent 身份；默认 feature flag 仍关闭，现场灰度待办。
- 2026-08-21：对照 Codex `rust-v0.149.0` 将 approval/reviewer/sandbox policy 接入每次
  `turn/start`；权限切换保持 loaded thread，UI 明确为“按需批准”。
- 2026-08-21：补齐 ghost running 权威协调：queue 查询和停止入口都能一次性收口，renderer
  对活跃历史会话做低频健康核对；静态/聚焦测试已通过，真实开发版现场复测待办。
- 2026-08-21：最终 lifecycle 复核发现默认关闭路径仍向 `CodexAppServerExecutor` 传入空
  options，破坏旧执行器替身与 feature flag 回滚契约；已恢复无 Supervisor 时的无参数构造。
- 2026-08-21：最新验证为三包 strict typecheck 通过，Runtime 9 文件 105/105（含真实 SQLite
  lifecycle）通过，renderer 2 文件 17/17 通过，定向 ESLint 0 error；两轮源码复核无遗留
  critical / important 缺陷，真实开发版灰度仍待执行。
- 2026-08-21：修复 runtime 与 JS SDK 精确绑版导致的假“未安装”；以旧 `0.144.5` 官方
  `generate-ts` schema 反证当前 turn 权限与 client message 字段兼容，并保留最低协议基线。
  同时按 OpenAI Skills 官方文档把描述裁剪识别为独立预算告警，覆盖新版文案及历史回放。
- 2026-08-21：动态 Team / Plugin MCP bridge 已按 Runtime lease 复用 bearer 和连接，并在
  turn 边界切换 handler generation；工具目录变化会安全轮换资源。P4 后端诊断和 idle-only
  手动重启已接到 Platform Bridge / MCP，真实灰度数据与 Settings UI 仍待完成。
- 2026-08-21：两轮源码复核确认并修复两个 required finding：Team 目录指纹需兼容现有
  `z.custom()` schema；bridge resource/error 不得携带原始 lease/session 标识。
