# Team Mode Outcome Room / Living Team Ledger

> 状态: 已落地 | 最后核对: 2026-08-17

## 当前已落地范围（P0）

本批已落地 Room Ledger 领域层、Team Runtime/MCP 接入，以及 Outcome Room UI P0 垂直切片。`@spark/storage` 提供 Room Ledger service/repository，SQLite migration 072 创建事件日志和可重建当前投影，migration 073 解除事件历史对可重建投影的外键依赖，migration 074 将版本/current 唯一性与事件索引升级为 discussion scope。

- 结构化、版本化记录：room/discussion、logicalKey、value、status、authority、confidence、sourceRefs、版本、actor/time、过期时间、纠错关联和原因。
- 操作：create、replace、correct、invalidate、tombstone；每次操作以唯一 `opId` 幂等。
- 并发治理：`expectedVersion` 做 CAS；版本不匹配抛出冲突，不静默覆盖。
- 混合权威：`user-confirmed`、`system-observed`、`agent-inferred`；持久化 authority 只由 `RoomLedgerService.forUser/forSystem/forAgent` 绑定的可信 capability 决定。为兼容旧调用暂时保留 mutation 的 `authority` 字段，但 service 会忽略它，调用方不能借 payload 提升或降低记录权威。
- 权威等级固定为 user > system > agent；低等级 actor 不能修改更高等级的 current 记录，同级或更高等级 actor 的新 revision 使用 actor 自身权威。
- 默认上下文只返回未过期的 active/proposed 当前记录，按更新时间、版本和记录 ID 稳定排序，并在 SQL 层将读取条数限制在 1–100；失效、删除、替代和过期记录仍可从历史和事件日志追踪。
- 每个 `(room, discussion)` 最多保留 100 个 current logicalKey。新 key 的配额检查与写入处于同一个 SQLite 写事务；已有 key 的 revision 不新增配额，不同 discussion 分别计数。
- `replay(roomId)` 在同一个写事务中清理并按事务内读取的事件顺序原子重建当前投影；事件日志是追加写入的权威历史，不会因 replay 被删除或重写。并发写入会在 SQLite 写事务边界内串行化，避免快照窗口丢失新事件。

## 数据模型和状态机

事件日志是追加写入的事实来源；每个事件包含操作、操作者、`opId`、discussion、前后记录和完整记录快照。投影按 `(roomId, discussionId, logicalKey)` 保留一个 current revision，并通过 discussion 内独立的 `version` 与 `supersedes` 形成纠错链；同一 room 的不同 discussion 可以复用相同 logicalKey，读取和治理互不串扰。legacy `discussionId = null` 记录保留原有 room/key 唯一语义。

记录状态支持：`proposed → active → superseded | invalid | expired | deleted`，以及 `proposed → rejected`、终态记录 `restore → active`。`conflict` 表示 CAS/治理异常，不作为当前 service 的持久化状态。无效、删除、替代和过期记录不进入默认 active context，但不物理删除历史。

事件写入与投影更新在同一个 SQLite 事务中完成；migration 073 解除了事件对可重建 records 投影的外键依赖，migration 074 完整复制既有 records 并从权威 `record_json` 回填 events.discussion_id。room 级 replay 只删除该 room 的可重建 records 投影，然后在同一事务内重放全部 discussion 事件，discussion-aware current/version 约束保证不同讨论不会互相覆盖。`restore({ expiresAt: null })` 会显式清除旧过期时间；省略 `expiresAt` 则保留旧值；Runtime MCP 与 Outcome Room UI 的 restore 边界固定传入 null，使恢复记录重新进入 active context。

## 后续批次

### Typed Handoff / Steering Gate（已落地 P1 垂直切片）

- Storage migration 075/076 新增 discussion-scoped typed handoff 与 steering gate 表、事件历史和版本/CAS 约束；service 提供创建、合法状态迁移、幂等 `opId`、权限能力绑定、分页和会话清理。
- `TeamP1RuntimeAdapter` 已进入统一 Team Runtime tool registry，将 handoff/gate 工具绑定到可信 session/discussion/actor capability；agent 只读和创建草稿/等待 gate，system/user 才可执行治理迁移。
- Steering Gate 已接入统一 `TeamDispatchService.run()` 执行前守卫；对 task 精确匹配的 waiting/revise/stopped/expired gate 会阻止成员执行，approved gate 才放行，并按既有 failed dispatch 路径留下事件。
- 桌面 user capability 可治理 agent 目标的 handoff，事件仍保留真实操作 actor；handoff/gate 及事件历史在 session runtime 清理时与其他 P2 数据一起删除。
- 新增 `team-p1:get` / `team-p1:mutate` typed IPC 与主进程 backend。renderer 仅提交 sessionId 及 discussion/version 快照，主进程重新解析可信 Team Mode discussion，并用 user capability 执行写入；Outcome Room 追加最小 Typed Handoff 与 Steering Gate 面板。
- 已完成 Handoff + Steering Gate 垂直切片验证：Storage P1、Runtime Ledger/P1、backend/IPC 与 Outcome Room UI 均已完成定向回归，真实 Electron 端到端验收仍待补充。

### Team Runtime/MCP（已落地）

- `TeamLedgerRuntimeAdapter` 将 room/session 与 discussion 作用域绑定到可信 runtime context，不接受工具调用方传入任意 room/session/discussionId。
- `team_ledger_read`、`team_ledger_propose`、`confirm`、`reject`、`correct`、`invalidate`、`tombstone`、`restore` 通过同一份 TeamToolDefinition 同时供 in-process MCP 与 HTTP bridge 使用；agent runtime 只暴露读取和 proposed 写入，host/system context 才能执行治理变更。
- 成员派发前把当前 discussion 的 active、未过期 Ledger 摘要注入成员 prompt，摘要包含 authority、version、source，并受条数和字符预算限制；adapter 将条目上限下推到 Storage SQL 查询，不先全量读取再截断。
- agent 写入边界限制 logicalKey/sourceRefs 与 JSON value 的深度、节点数、循环引用和近似序列化字节数；摘要把 Ledger 明确标为不可信数据，转义控制字符并使用有界序列化，避免把内容当作指令或无界展开。
- @ 成员直答路径固定为 `agent-inferred`；host/system 仅记录 `system-observed`，不会伪称 `user-confirmed`。成员工具面只暴露读取和 proposal/fact 增量，治理工具仅对可信 host/system context 可见。
- session 删除事务同步清理确定性 `team-room:{sessionId}` 的 Ledger events 和 records，避免跨会话残留。
- Task Graph、结构化 Deliberation、Evidence/Cost、Replay/Playbook、P1 五类 runtime adapter 均绑定可信 session/discussion/actor capability；同一组 `TeamToolDefinition` 同时供 Claude in-process MCP 与 Codex HTTP bridge 使用。Task Graph 拒绝跨 discussion 复用节点/边 ID，成本账本由真实 dispatch 结果自动记录并支持分页读取/全量聚合，session 清理同步删除六类 session-owned 数据，避免已删除会话残留。
- Deliberation 决策与可选 Ledger 写入在同一 storage transaction 内完成；Ledger 写入失败会回滚决策事件，使用相同 `opId` 可安全重试。

### Outcome Room IPC/UI（已落地 P0 垂直切片）

- 独立 `outcome-room` typed IPC 契约只接受 `sessionId`；renderer 不能传入 room、discussion、authority 或 actor。主进程验证 Team Mode 和可信主窗口后，自行解析当前/最近 discussion，并固定 room 为 `team-room:{sessionId}`。
- UI 使用 `RoomLedgerService.forUser` 执行 confirm、reject、correct、invalidate、restore；所有治理动作带 snapshot 的 discussionId、recordId 和 version。Backend 先做 scope 预检，Storage service 再在同一 SQLite 写事务内重新解析 session 当前 discussion，并核对 current record 的 ID、discussion 和 version，全部一致后才追加事件，避免讨论切换或同版本同 key 卡片穿透。冲突显示可恢复错误并保留最后一次有效快照。
- Outcome Room 嵌入 Team Inspector，提供结果优先 Overview、讨论/运行成员协同状态、Living Ledger 当前投影、来源/权威/状态/版本/更新时间，以及 proposal 确认、驳回、纠错、失效和终态恢复。
- 数据经 IPC 初次读取，窗口重新聚焦或页面重新可见时立即刷新；可见页面每 2 秒低频读取一次 Storage 权威投影，隐藏、卸载和 session 切换时暂停/清理。选择受控轮询是因为 Agent/MCP 写入发生在 `agent-runtime`，不应反向依赖 Electron 主进程广播；该路径能统一覆盖 UI、成员 MCP 和恢复写入。旧 session 的 refresh/mutation 响应受 generation 守卫，不能覆盖新 session。
- UI 覆盖 loading、无 discussion、空 Ledger、部分刷新错误和 CAS conflict，使用 Lucide 图标、语义文字+颜色双编码、键盘 focus、reduced motion，以及 375/768/1024/1440 宽度下不横向溢出的响应式布局。

- Outcome Room 容器现挂载 Evidence/Cost、Task Graph/Deliberation、Replay/Playbook 三类面板；Replay/Playbook 使用当前 Outcome Room discussion scope，discussion 不存在时不发起读取。

TaskGraph、结构化 Deliberation、Evidence/Cost、Replay/Playbook、P1 已完成本批最小 runtime/UI 接线，并通过对应聚焦门禁；真实 Electron 端到端验收尚未完成，当前未作通过声明。

## 交付验证（2026-08-17）

- 本轮增量聚焦回归通过：Storage 团队治理相关 5 个测试文件 30/30；Agent Runtime dispatch/tooling/Deliberation/Ledger 4 个测试文件 51/51；Storage 与 Agent Runtime strict typecheck 通过。
- 本轮补充验证了 P1 runtime 注册、Gate 执行前阻断与 approved 放行、Task Graph 跨 discussion ID 保护、成本 dispatch 自动记录/分页聚合、Deliberation Ledger 失败回滚重试，以及 handoff/gate session 清理。
- Task Graph retry 后下游保持 blocked，直到上游 completed 才释放；这是依赖 DAG 的预期语义，不把 retry 误判为立即释放下游。

- 独立后端/运行时与前端/IPC 对抗审查均为 `APPROVED`，未发现仍可复现的权限、作用域、幂等、CAS、竞态、XSS 或资源边界缺陷。
- 聚焦回归通过：Protocol 14/14、Storage 60/60、Agent Runtime 31/31、Desktop Outcome Room 70/70；严格类型检查中 Protocol、Storage、Agent Runtime 通过，Outcome Room 相关 Renderer 文件无类型诊断。
- Desktop production build 通过；migration 1–82 已在聚焦测试的临时 SQLite 中实际执行，静态 migration 校验也通过。
- 恢复 Electron ABI 并重新构建后，Playwright 的 production shell 启动冒烟已通过（1/1）；此前 `SIGABRT` 属于原生模块 ABI 环境问题。Outcome Room 专项真实界面验收仍受限：对当前 SparkWork 使用受治理桌面控制时连续停留在 `planning` 且未取得控制租约，现有独立 Electron E2E 也没有可复用的 Team discussion fixture。因此 375/768/1024/1440、深浅主题和真实 Tab 焦点仍保留为具备 Team fixture 后的冒烟验证项。
