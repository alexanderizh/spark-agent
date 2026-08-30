# Computer Use V2 Phase 6 · 治理瘦身与风险闸门审查

审查日期：2026-08-01

## 结论

Phase 6 自主代码范围通过审查：L0/L1 会话内动作不新增审批或同步磁盘等待；L2/L3 仍需 digest-bound 单次 ticket，并在 ticket 消费和 backend 执行前同步确认当前 before-frame 已完成脱敏加密落盘。落盘失败时 action 标为 blocked、ticket 不消费、backend 不执行。L4、无人值守升档、目标绑定、敏感数据和 Full Access 边界均未弱化。

## 三遍审查

### 第一遍：需求与顺序

- `ComputerPolicyService` 已实现 L0/L1 allow、L2/L3 approval、L4 handoff；审批对象只在 L2/L3 创建。
- `ComputerObservationEvidenceStore.persist()` 对普通动作保持 fire-and-forget；`flushPendingWritesOrThrow(sessionId)` 只由 Broker 的 L2/L3 ticket 路径调用。
- Broker 顺序固定为：policy → requested action → approval/ticket → high-risk evidence flush → ticket consume → `startExecuting` → backend。

### 第二遍：正确性、安全与竞态

- flush 失败会把 action 标为 `blocked/environment_unavailable`，并附 `high_risk_evidence_persist_failed` / `persist` / 修复动作；不会消费 ticket 或调用 executor。
- EvidenceStore 保存每会话最新持久化失败；同会话后续成功 before-frame 会清除旧失败，低风险历史失败不会永久阻断后续已成功固化的高风险动作。
- clearSession 清理内存帧与失败状态，尚在结算的旧 promise 完成后再次清理，避免新增失败分桶泄漏。
- action/target/data digest、nonce、TTL、单次消费、远程仅 L2、L4 handoff、unattended handoff、unknown/首次动态应用升 L2 均原样保留。
- Full Access 只自动签发 L2/L3 ticket；由于 flush 在 Broker 内、位于 ticket 消费前，Full Access 不能绕过高风险证据门禁。

### 第三遍：五轴代码质量

- 正确性：覆盖 L1 不 flush、L2 flush 早于 consume/execute、flush 失败 blocked、EvidenceStore 异步失败与高风险 fail-closed。
- 可读性：Broker 只依赖注入回调，不反向依赖 EvidenceStore；错误诊断使用既有 `ComputerUseBrokerError`。
- 架构：证据持久化策略留在 Store，风险执行顺序留在 Broker，composition root 只负责接线。
- 安全：日志不包含截图、输入文本或路径；错误只输出稳定码与修复动作。
- 性能：L0/L1 没有新增 await；L2/L3 只等待本会话串行证据链，不等待其他会话。

## 验证证据

- Phase 6 聚焦 Vitest：6 文件 46 项通过；Computer Use 全量 43 文件 295 项通过（普通沙箱 288 项，7 项回环 HTTP 在允许监听 `127.0.0.1` 的环境复跑通过）。
- `npx tsc -p apps/desktop/tsconfig.node.json --noEmit`：exit 0。
- 提交前继续执行 Computer Use 全量回归、`git diff --check` 和精确 pathspec 核对。

## 外部发布复核

发布签收需再次抽查真实审批 UI、Full Access 与普通模式各一条 L2/L3 动作，并确认失败磁盘场景的修复提示可见；这属于真实安装包签收，不改变本阶段自主代码已完成的结论。
