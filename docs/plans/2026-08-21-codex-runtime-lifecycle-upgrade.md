# Codex Runtime 生命周期升级计划

> 状态: 实施中 | 最后核对: 2026-08-21

## 背景

真实复现中，Spark 已接受 turn 后，Codex App Server 的 `user_message` 最晚延迟
7.592 秒才出现。数据库与源码证据确认该窗口位于每轮重新执行
`spawn → initialize → thread/resume|start` 的准备阶段；与此同时，renderer 的
optimistic 气泡没有稳定完成可见绘制。

官方 Codex App Server 0.149.0 面向产品内嵌的协议要求每条连接依次完成
`initialize` 与 `initialized`，并支持持久 thread、流式事件、审批、steer、compact
和真实 `clientUserMessageId`。Spark 当前按 turn 新建并销毁 App Server，仅使用了流式
协议，尚未真正使用持久生命周期。

## 目标架构

```text
Composer
  └─ clientMessageId + 即时本地气泡
        ↓
SessionService
  └─ 用户消息、队列、事件库的产品权威来源
        ↓
Codex Runtime Supervisor（后续阶段）
  └─ 进程租约、健康检查、TTL、崩溃恢复、thread 绑定
        ↓
Codex App Server
  └─ agent loop、工具、审批、流式事件
```

Spark 继续拥有产品状态、持久事件、队列和跨引擎一致性；Codex thread 只作为受管的
原生运行时绑定，不能反向成为 Spark 会话的唯一数据源。

## 分阶段实施

### P0：发送反馈与引擎准备解耦（本次实施）

- Composer 创建 `clientMessageId` 后同步提交 optimistic 气泡，并让出一次浏览器绘制。
- 后续附件准备、runtime patch 和 IPC 不再阻塞首个可见反馈。
- `started=false` 时仍移入既有队列，稳态下不把排队消息留在聊天流。
- `clientMessageId` 贯穿 IPC、durable queue、`user_message` 和 App Server
  `clientUserMessageId`，持久消息按 client id 或 turn id 承接 optimistic 气泡。
- 带 client id 的用户消息由 SessionService 在确认起跑时持久化；executor 的重复
  `user_message` 被抑制。历史构建显式排除当前 turn，避免模型重复收到当前输入。

### P1：协议与观测地基（本次实施）

- `initialize` 成功后发送官方要求的 `initialized` notification。
- 协议子集按 0.149.0 `generate-ts` 重新核对。
- 增加 App Server spawn、initialize、resume/start、prepare、turn/start 分段指标；
  首输出继续复用统一 `requestToFirstOutputMs`。

### P2：多路复用 Client 与 Runtime Supervisor（已实现，待灰度）

- 已新增单 reader 的 request/thread/turn 动态路由，缓存 turn 注册前的抢跑事件。
- 已通过单 session lease 实现串行闸门；transport 退出时唤醒所有 waiter。
- 已实现懒启动、并发 acquire 合并、空闲 TTL、LRU 上限、崩溃回收和应用退出清理。
- 通过 `SPARK_CODEX_PERSISTENT_RUNTIME=1` 灰度启用，默认仍走旧每-turn lifecycle。
- 动态 Team / Plugin MCP HTTP bridge 已提升到 Runtime lease 生命周期：同一目录复用
  bearer/连接并在 turn 边界切换 handler；TTL/LRU、崩溃、失效与 shutdown 统一撤销。
- 工具目录/schema 变化时轮换 bearer 并触发 runtime fingerprint 重建；相同 sidecar 在
  fingerprint 轮换时可原子转移，不以忽略 token 的方式复用旧授权。

### P3：真实 Codex thread 绑定（已实现，待灰度）

- 已把真实 thread id 与 runtime/thread 双 fingerprint 持久化到 session metadata；同一
  binding key 保留多组候选，配置切回时可恢复旧 thread，最近记录总量限制为 12 条。
- warm runtime 直接复用内存中已加载的 thread；应用重启后仅在两个 fingerprint 都匹配时
  执行 `thread/resume`。Provider、模型、工作区、MCP 或 Agent 身份变化时新建绑定。
- 权限、sandbox、网络与额外可写目录改由每次 `turn/start` 显式覆盖；从完全访问切回按需批准
  不再新建 native thread，当前 turn 立即采用最新策略。审批 reviewer 也始终显式下发，避免
  从自动审查切回用户审批时沿用上轮 sticky 配置。
- native loaded/resume 成功时不重复注入 Spark 历史；fresh、resume 失败或 SDK fallback
  使用 standby continuity history 恢复上下文。
- Host、mention 与 Team member 使用独立 binding/lease scope，避免 Host 等待成员时互锁。
- fresh thread 绑定必须先持久化再允许 `turn/start`；持久化失败只在 turn 开始前回退。
- fallback 只允许发生在 `turn/start` 之前；已开始的 turn 禁止自动二次执行。

### P3-C：运行态权威协调（已实现，待现场复测）

- `getQueueState` 以 TurnRegistry starting/executor 和 Team dispatch 为内存执行权威；当数据库
  残留 `running` 而上述执行均不存在时，补齐断流轮终态并把 session 恢复为 idle。
- `cancelTurn` 遇到同类 ghost running 时返回成功收口，不再误报“没有运行中的任务”；真实
  starting/executor/Team dispatch 分支保持原有取消语义。
- 当前活跃的 running 历史会话在切换、窗口聚焦与 15 秒低频周期内查询权威队列；返回 false
  时同时清理 sidebar session status 与历史 `agent_status` spinner。
- Codex 默认权限 UI 改名为“按需批准”，明确 workspace 内安全写入自动执行、越界操作才请求
  批准；未把官方 `on-request + workspace-write` 偷换成每次写入都确认。

### P3-D：Runtime 升级兼容与 Skills 告警分类（已实现）

- 已安装且文件完整、版本不低于 `0.144.5` 协议基线的 native runtime 不再与应用内
  `@openai/codex-sdk` 精确绑版；应用升级后继续可用，匹配当前 SDK 的云端 runtime 作为
  `update_available` 可选升级呈现。
- Codex runtime 的自动更新默认关闭；用户在完整性页显式开启后仍持久化并尊重该选择。其他
  可选能力维持既有自动更新默认值。
- 安装路径仍只接受声明兼容当前 SDK 的 artifact，并保留平台、SHA-256、归档结构与可执行文件
  校验；兼容运行与下载信任边界相互独立。
- Codex Skills 初始目录的描述裁剪属于独立 context budget 告警，不代表模型总上下文耗尽。
  SDK、CLI、App Server 以及 renderer 历史回放均按三个语义锚点过滤该良性 warning；普通
  `CODEX_SDK_ITEM_ERROR` 仍照常展示。

### P4：资源治理与诊断（后端已实现，待真实灰度）

- Supervisor 可按需返回 PID、RSS、句柄、loaded thread、进程/lease 数量，以及 cold/warm、
  native thread mode、TTL/LRU、crash、失效、启动失败和手动重启计数。
- 对外只返回哈希 lease id；不包含 token、环境变量、runtime/thread fingerprint 或 session id。
- Platform Bridge / MCP 已提供 idle-only 手动重启；active Runtime 返回 busy 并保持当前 turn。
- 待真实开发版采集资源基线、warm/resume 命中率与回收数据，再决定是否设计受控共享池。
- Settings / 完整性页的诊断摘要与手动重启按钮尚未产品化。

### P5：能力扩展（待实施）

- 接通 steer、compact、fork、review、结构化用户提问、本地图片和动态模型能力。
- 资源压测后再评估从单 session lease 灰度到受控 fingerprint 共享池。

## 验收与回滚

- 点击发送到用户气泡 DOM 可见：p95 ≤ 100ms。
- warm runtime acquire + `turn/start`：p95 ≤ 300ms。
- 重复用户消息、重复 turn、跨会话事件必须为 0。
- 排队、取消、失败、进程崩溃、Provider/MCP/权限变化均有聚焦测试。
- 每阶段使用 feature flag 灰度；P2 以后可按单会话回退旧的每-turn 载具。

## 当前验证

- protocol、agent-runtime、desktop TypeScript strict 检查通过。
- Runtime 9 个聚焦文件 105/105 通过，包含 Router、Client、Supervisor、persistent Runtime、
  Executor、native binding、Registry 与真实 SQLite lifecycle；测试前后通过仓库脚本切换并恢复
  `better-sqlite3` Node / Electron ABI。
- renderer 的侧栏权威状态协调与权限文案 2 个文件 17/17 通过；既有测试仍打印 React
  `act(...)` warning，但没有失败，新增用例已覆盖 queue=false 清理。
- P2 Router、Supervisor、Client lifecycle、Executor 与双 turn 持久 runtime 聚焦测试
  已通过；双 turn harness 确认只 spawn/initialize 一次，第二轮记录为 warm。
- P3 聚焦测试覆盖 loaded thread、进程重启 resume、fingerprint 失配、备用历史、Agent
  scope、Host/Team lease 隔离、binding 持久化失败和 metadata 候选上限。
- 权限/状态一致性聚焦测试覆盖同一 loaded thread 的 full-access → on-request 切换、turn 级
  reviewer/sandbox/network/writable roots、ghost running 的 queue/cancel 收口、真实执行保护和
  renderer 权威 queue=false 清理。真实开发版现场复测仍未完成。
- 默认关闭兼容性已回归：未创建 Runtime Supervisor 时仍使用 `CodexAppServerExecutor()`
  无参数构造，不向旧 lifecycle 测试替身或回滚路径注入 supervisor options。
- Runtime/Skills 修复的聚焦回归已通过：兼容旧 runtime 保持 installed 并提示可选更新，低于
  协议基线的 runtime 仍拒绝；三种 Codex 载具不再把新版 Skills 预算文案映射为执行失败，
  renderer 也会忽略已经持久化的同类假错误。
- 动态 MCP lease 与 P4 后端诊断聚焦测试覆盖：跨 turn bearer/连接复用、最新 handler 切换、
  schema 轮换、TTL/启动失败/shutdown 资源回收、fingerprint sidecar 转移、诊断脱敏和
  idle-only 手动重启；Team 目录指纹兼容现有 `z.custom()` 工具 schema。
- 本批最终验证：protocol、agent-runtime、desktop strict typecheck 通过；合并后的 13 个
  Runtime/Bridge/Platform 文件 118/118 通过，lint 修复后桥接回归 11/11 通过；定向 ESLint
  0 error（51 个既有 non-null/any warning），Prettier、MCP server 语法与 `git diff --check`
  通过，SQLite 依赖已恢复 Electron ABI。
- 本轮最终验证：protocol、agent-runtime、desktop strict typecheck 通过；Codex Runtime/SDK/
  CLI/App Server 91/91，完整性/可选升级/renderer 81/81；定向 ESLint 0 error；Prettier 与
  `git diff --check` 通过。GitNexus 纯索引更新为 70,082 nodes / 126,953 edges / 300 flows。
- 两轮最终源码复核未发现未解决的 critical / important 缺陷；定向 ESLint 0 error，
  warning 均位于既有规则命中处。
