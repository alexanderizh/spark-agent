# Computer Use V2 · Phase 2.1 Host Supervisor 阶段审查报告

> 日期: 2026-07-31 | 阶段: Phase 2.1 (WP3 Host Supervisor) | 状态: 已落地（feature flag 默认关闭）

本报告是 Computer Use V2 计划 Phase 2.1 的只读审查快照，记录改了什么、为什么、验证证据、安全不变量与遗留项。

## 1. 需求覆盖

计划 §2.1 要求新增 Host Supervisor 状态机，消除「任何瞬时抖动置位 terminalError 闩锁→整个 turn 死亡」的脆弱性，并补上主动健康探测与有界崩溃恢复。

| 计划要求 | 落地情况 |
| --- | --- |
| 状态机 absent→verifying→starting→handshaking→ready + degraded/restarting/failed | `NativeHostSupervisor` 实现 absent/starting/ready/degraded/restarting/failed（verifying/starting/handshaking 合并到 connect() 单步，因 NativeHostClient.connect 已内含 verify+spawn+handshake） |
| 心跳 5 秒一次，连续 3 次失败才重启 | `NativeHostHealthService`，默认 5000ms / 阈值 3，可注入 |
| 会话中崩溃最多自动重启 1 次 | `maxRestartsPerSession` 默认 1，硬上限防重连循环 |
| 重启后必须重新绑定目标和观察，绝不续执行旧动作 | `onRebound` 回调清空 backend `observationSessions`，强制下次动作重新 observe+rebind |
| 退出 App 或用户停止控制时释放输入、捕获流、权限会话 | `dispose()` 停心跳 + 关连接；backend `dispose` 委托 |
| Feature flag `computerUseV2.hostSupervisor` | `computerUseV2Flags.ts` 读 `SPARK_COMPUTER_USE_V2_HOST_SUPERVISOR`，默认关；Phase 7 统一 flag 框架 |

## 2. 主要文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `apps/desktop/src/main/services/computer-use/NativeHostHealthService.ts` | 新增 | 心跳探针，3 连败才宣告不健康 |
| `apps/desktop/src/main/services/computer-use/NativeHostSupervisor.ts` | 新增 | 连接生命周期状态机 + 有界重启 + rebound |
| `apps/desktop/src/main/services/computer-use/computerUseV2Flags.ts` | 新增 | V2 flag 读取器（Phase 7 会替换为统一框架） |
| `apps/desktop/src/main/services/computer-use/NativeHostComputerUseBackend.ts` | 修改 | 可选注入 supervisor；getConnection/invalidateConnection/dispose/cancelSession 在 supervisor 存在时委托 |
| `apps/desktop/src/main/services/computer-use/NativeHostBackendFactory.ts` | 修改 | 按 flag 传 `enableHostSupervisor` |
| `apps/desktop/src/main/services/computer-use/NativeHostSupervisor.test.ts` | 新增 | 8 个聚焦测试 |

## 3. 设计要点

- **分层守住 SIGKILL 安全不变量**：Supervisor 位于 NativeHostClient 之上。NativeHostClient 的 fail-closed（digest 篡改/超时/协议违例→SIGKILL）原样保留；Supervisor 只是观察到死亡后决定是否在预算内重连。篡改类失败重连会再次失败→预算耗尽→`failed`，不会循环。
- **不主动后台重连**：`reportTerminalFailure` 只置位 `degraded`，重连发生在下次 `acquire()`（调用方 tick），避免无消费者时后台空转重连。仅心跳探到的死亡在 `handleUnhealthy` 里立即重连一次（仍在预算内）。
- **onRebound 强制重绑**：新连接建立后清空所有 observationSessions，因为新 host 进程丢了全部会话状态；绝不复用旧 frame 的规划。
- **flag 关闭 = 旧行为**：supervisor 为 null 时 backend 走原 lazy-connect + invalidate 路径，保证现有测试与生产行为零变化。

## 4. 验证证据

- `pnpm vitest run apps/desktop/src/main/services/computer-use/` → **29 文件 / 188 测试全过**（含新增 8 个 supervisor 测试）。
- `pnpm -w tsc --noEmit -p apps/desktop/tsconfig.json` → **exit 0**。
- supervisor 测试覆盖：懒连接复用、并发 acquire 去重、terminal failure 后预算内重连 + onRebound 触发、预算耗尽→failed、心跳不健康→重连、心跳不健康且无预算→failed、foreign 连接 reportTerminalFailure 被忽略、dispose 停心跳+关连接。

## 5. 安全不变量核对（零回归）

- [x] click/type 基线 L1 未动。
- [x] T01 intent 升档未动。
- [x] unknown→L2、L2/L3+unattended→handoff、sensitive→L4 handoff 未动。
- [x] codex-full-access/claude-bypass 跳过逐动作审批未动。
- [x] **NativeHostClient 超时/digest fail-closed SIGKILL 测试（NativeHostClient.test.ts:212/239）保持绿**——Supervisor 不触碰单连接内部的 terminate/SIGKILL。
- [x] 全链路无新增 `any`（NativeHostConnection fake 在测试里经 `as unknown as` 断言，属测试桩，非生产类型逃逸）。

## 6. 遗留项与风险

- **feature flag 是环境变量级**：Phase 7 需替换为统一 flag 框架（灰度/回退条件），届时仅改 `computerUseV2Flags.ts`，不动调用方。
- **心跳探针用 `getCapabilities`**（client 侧 1s 缓存，轻量）；若后续 wire 层加入专用 `ping` 节流语义，可换更轻探针。
- **rebound 清空全部会话的 observation**：当前每会话独立 backend 实例下等价于清当前会话；若未来一个 supervisor 跨多会话共享，需把 onRebound 收窄到受影响会话。
- **未做「App 启动惰性预热」**：当前仍按首次 acquire 懒启动心跳；计划要求的 App 启动预热待 Phase 5/7 状态 UI 接入时补（需 app lifecycle 钩子）。
- **GitNexus impact 未跑**：当前 agent 工具集无 GitNexus MCP（与记忆一致），已用源码人工 trace 直接调用方（backend.getConnection/invalidateConnection/dispose/cancelSession + factory）。实施方合并前可补跑 `gitnexus_impact({target:'NativeHostComputerUseBackend', direction:'upstream'})` 复核。

## 7. 回滚

- 关 flag：`SPARK_COMPUTER_USE_V2_HOST_SUPERVISOR` 不设 → 完全走旧路径。
- 代码回退：supervisor 为可选注入，删除 backend/factory 接线 + 3 个新文件即回退到 Wave 1 状态。
