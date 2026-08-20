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

### P2：多路复用 Client 与 Runtime Supervisor（待实施）

- 单 reader 按 request/thread/turn 路由，缓存 turn 注册前的抢跑事件。
- 同一 thread 串行闸门；transport 退出时唤醒所有 waiter。
- 先按 session 独占 lease：懒启动、并发 acquire 合并、空闲 TTL、LRU 上限、崩溃回收。

### P3：真实 Codex thread 绑定（待实施）

- 持久化 Spark session + runtime fingerprint → Codex thread id。
- Provider、模型、工作区、权限或身份不兼容时创建新绑定，通过 Spark continuity 恢复。
- fallback 只允许发生在 `turn/start` 之前；已开始的 turn 禁止自动二次执行。

### P4：能力扩展（待实施）

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
- optimistic、event mapper、协议 schema、App Server harness、阶段指标等不依赖 SQLite 的
  聚焦测试通过。
- SQLite 生命周期集成测试当前被本机 `better-sqlite3` Node ABI 不匹配阻断；同文件既有
  用例也全部在数据库打开前失败，未把环境失败误报为代码失败。
