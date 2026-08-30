# Computer Use V2 · 总体审查与发布签收清单

> 日期: 2026-08-01 | 结论: 自主代码与文档交付完成，正式可用状态仍受 6 项真机/发布证据阻断

## 1. 总体结论

Phase 0–7 的自主代码范围已经落地：细粒度诊断与指标、最终产物发布门禁、Host Supervisor、双平台持久捕获、AX/UIA 事件缓存、增量树、动作 batch、三通道输入协同、Timeline 持久化/实时 UI、治理瘦身、事件等待、统一 flags 与运行期单项回退。V2 核心路径现已默认启用，旧路径仍作为显式 opt-out 和自动回退保留。

不能把项目标成“正式发布验收通过”：最终签名 DMG/NSIS、权限撤销恢复、真实 takeover P99、L0/L1 20 ms 预算、全量 SLO 与两平台干净 VM 黄金任务 100 次仍需要证书、CI/VM、Windows/macOS 真机和跨版本数据。本报告把这些条目保持未通过，不使用 mock、本地 ad-hoc 或编译成功替代。

## 2. 阶段审查汇总

| 阶段 | 自主交付 | 审查结论 |
| --- | --- | --- |
| Phase 0 | 诊断 IPC/MCP、版本分桶指标、Beta 能力说明 | 代码完成；真机基线待签收 |
| Phase 1 | 共享版本/provenance、afterSign、最终 App-owned handshake、发布验证器 | 门禁代码完成；DMG/NSIS 实装待签收 |
| Phase 2 | Supervisor、持久 SCStream/WGC、AXObserver/UIA cache、增量树、异步证据 | 代码完成；Picker/真实性能待签收 |
| Phase 3 | 2–8 项 batch、逐动作 Broker、新鲜度中断与重观察 | 完成，默认启用并可回退 |
| Phase 4 | 后台语义/前台输入、双平台接管、Tray/控制卡、窗口绑定、AppControlBridge | 代码完成；真实 20 动作/P99 待签收 |
| Phase 5 | migration 064、14 类事件、实时流、重启回放、Renderer 卡片 | 完成 |
| Phase 6 | L0/L1 热路径、L2/L3 before-frame 固化、ticket 顺序与失败阻断 | 自主代码与对抗审查完成；发布抽查待签收 |
| Phase 7 | 统一 flag、默认放量、事件等待、指标阈值与单项回退 | 代码完成；百分比运营与删旧链路待跨版本签收 |

## 3. 发布阻断清单复核

### 已通过（代码与本机证据）

1. App/Host/manifest 使用共享版本与 build provenance。
2. 签名、hash、协议、架构、权限、spawn/handshake 具有独立 diagnosticCode/stage/repairAction。
3. Timeline 实时展示、持久化、游标回放与 Renderer 去重链路完成。
4. L0/L1 无动作审批；L2/L3 在 backend 前执行 digest/ticket/evidence 闸门；L4 handoff。
5. Host trust、目标、权限、视觉帧和可访问性树均有失效条件缓存。
6. stale frame/tree、窗口变化与 Host 短暂断连使用一次有界恢复，不透明重放非幂等动作。
7. 不等价浏览器 fallback 不会伪装桌面任务成功；默认 start_task 为全桌面委托，显式 target 才单窗口绑定。
8. SLO 指标、版本维度、有界样本阈值与运行期单项 rollback 已接线。

### 待外部签收（正式发布阻断）

1. 最终签名 DMG 安装后的 Host handshake。
2. 最终签名 NSIS 安装后的 Host handshake。
3. 首次权限、拒绝、撤销、恢复的双平台真实系统流程。
4. takeover 停止并释放输入 P99 < 300 ms。
5. L0/L1 policy+validation P95 ≤ 20 ms 及计划 §9 其余 SLO。
6. macOS/Windows 六类黄金任务在干净 VM 各连续通过 100 次。

## 4. Definition of Done 复核

代码层已经满足：细粒度可修复诊断、后台语义不抢焦点、前台短时输入与接管、持续 Timeline、batch、会话/风险边界、稳定事实缓存、有界恢复、状态 UI、强制发布门禁和去轮询。以下两项必须由外部证据封口：

- 正式包安装后无需手工修 Host（DMG/NSIS 实装矩阵）。
- 简单多步任务与全部 §9 性能 SLO 达标（真机基线与黄金任务数据）。

在这两项签收前，计划状态保持“实施中”，不得改成“已落地/正式可用”。

## 5. 本轮总体验证证据

- Computer Use：44 文件 / 288 测试通过（含 loopback MCP）。
- 打包、afterSign 与最终 App smoke：43 项通过。
- Computer Use protocol：5 文件 / 33 项通过。
- macOS Native Host：Swift 43 项通过。
- Windows Native Host：Rust 23 项通过；x64/arm64 MSVC `clippy -D warnings` 通过。
- `apps/desktop/tsconfig.node.json`、`apps/desktop/tsconfig.json`、`packages/agent-runtime/tsconfig.json`：均 exit 0。
- desktop production build：通过；migration 65 个文件静态校验通过。
- Storage Computer Use 15 项未执行成功：本机 `better-sqlite3` 为 Electron ABI 148，当前 shell Node 需要 ABI 127。真实 Electron dev 已成功打开数据库并完成 65 个迁移；该环境问题不记为测试通过，也不判定为本轮代码缺陷。

## 6. 外部签收执行

### macOS

1. 使用正式 Developer ID/公证环境执行 `pnpm --dir apps/desktop build:mac:arm64` 与 x64 runner 对应命令。
2. 挂载最终 DMG、拖入 `/Applications`、普通账户启动；执行 `pnpm --dir apps/desktop native:verify:packaged:mac -- --app "/Applications/SparkWork.app" --arch arm64`（x64 runner 改为 `--arch x64`）并保存结构化报告。
3. 执行权限拒绝/恢复、Host 删除/篡改、Retina/多显示器、窗口重建、20 个后台动作、takeover 延迟和六类黄金任务 100 次。

### Windows

1. 在 Windows release runner 执行 `pnpm --dir apps/desktop build:win:release`。
2. 在干净 Windows 10/11 VM 静默安装最终 NSIS，普通账户启动；执行 `pnpm --dir apps/desktop native:verify:packaged:win -- --app-dir "C:\\Program Files\\SparkWork" --arch x64` 并保存结构化报告。
3. 覆盖 Defender/SmartScreen、非 ASCII/含空格用户名、证书/bytes 篡改、权限/UAC、DPI/多显示器、20 个 UIA/SendInput 动作、takeover 延迟和黄金任务 100 次。

每份证据必须附 App/Host 版本、平台/架构、trust mode、flag snapshot、样本数、P50/P95/P99、失败诊断和 rollback event。签收完成后再把计划及 `docs/COMPUTER_USE_PLAN.md` 状态更新为“已落地”。

## 7. 文档同步

已同步总体路线、Broker、威胁模型、macOS Host，并新增 `windows-native-host-design.md` 与 ADR-002 三通道执行决策。GitNexus impact/detect_changes 本会话未暴露，按项目降级规则用源码调用点、测试、构建、双平台交叉编译和精确 Git diff 完成影响核对。
