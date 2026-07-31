# Computer Control Broker、租约与审批设计

> 状态: 已落地 | 最后核对: 2026-07-31

本文记录 CU-02 已落地的主进程电脑控制安全边界。后续 Native Host、Provider Adapter、Monitor、Workflow、远程控制和 Verification Engine 必须调用本 Broker，不得建立第二条键鼠、Accessibility 或截图执行路径。

## 1. 已落地模块

- `ComputerControlBroker.ts`：唯一动作派发入口，校验观察新鲜度、前台目标、任务范围、策略、审批和执行结果。
- `ComputerSessionManager.ts`：会话阶段、AbortSignal、独占 actuator lease、心跳、Pause、Resume 和 Cancel。
- `ComputerPolicyService.ts`：L0–L4 风险下限、任务合同和无人值守 fail-closed。
- `ComputerApprovalService.ts`：精确摘要、审批展示摘要复核、远程 L2 限制、nonce 哈希和单次消费。
- `ComputerUseBackend.ts`：CU-03/CU-09/CU-10 实现的最终 Host/Observer/Executor 接口；没有可信 Host 时能力探测明确返回 unavailable。
- `NativeHostArtifact.ts` / `NativeHostClient.ts` / `NativeHostComputerUseBackend.ts`：校验父应用与 Host 签名主体、最终字节 hash、manifest 和 wire 握手，管理长度前缀 pipe、按操作预算的超时、崩溃重连、窗口列表、捕获、full/diff observation 与动作后证据持久化。macOS/Windows Host 只在真实权限与后端可用时声明 AX/UIA/input；缺少任一能力时对应 observe/execute 继续 fail-closed。
- `ComputerKillSwitchService.ts`：全局快捷键注册、注册失败 fail-closed、重复触发合并和全部活动会话停止。
- `ComputerUseServices.ts`：使用真实 Storage Repository 的主进程 composition root。
- `computer-permission-action.ts`：`spark_computer` 任务级 MCP 权限映射；未知工具和低层动作永久拒绝。

主进程启动完成数据库迁移后初始化这些服务。默认 factory 在支持的 macOS 架构上尝试连接受信 Host；缺失、ad-hoc/异团队签名、hash/manifest/握手不符或 Host 未声明所需能力时保持 unavailable。在任何平台都不会退化成坐标脚本、BrowserBridge 或其他假执行器。

## 2. 动作信任模型

`ComputerActionEnvelope` 现在强制包含结构化 `policyContext`：

```ts
policyContext: {
  effect: 'read_only' | 'reversible_local' | 'external_write' | 'high_impact' | 'restricted'
  target: {
    kind:
      | 'application'
      | 'window'
      | 'element'
      | 'domain'
      | 'recipient'
      | 'file_policy'
      | 'system_setting'
      | 'account'
      | 'unknown'
    id: string
  }
  dataClasses: ComputerDataClass[]
}
```

Provider 或页面内容不能用该字段把风险降到 Broker 已知的动作下限以下。PolicyService 取“语义副作用等级、低层动作固有风险、未知目标、敏感输入”中的最高值：

- `observe`、`move`、`scroll`、`wait_for` 的动作下限为 L0；
- `focus_window`、`select_text`、`set_value`、`type_text` 的动作下限为 L1；
- `invoke_element`、`click`、`drag`、`keypress` 在缺少可信语义证明时下限为 L2；
- `unknown` 目标至少为 L2；
- `type_text`、`set_value` 携带非 public 数据类别时至少为 L2；
- credential 敏感输入和 `restricted` 副作用为 L4，只能接管。

因此，即使模型把“提交”按钮标注成 `reversible_local`，Broker 仍会按 click/invoke 的 L2 下限要求精确审批。后续 CU-05 若增加可信 DOM/AX 语义分类，也只能通过主进程受控分类器提高证明强度，不能让 Provider 自行声明降级。

## 3. 派发顺序

每个动作按以下固定顺序处理：

1. 使用严格 schema 解析 envelope，未知字段或动作直接拒绝。
2. 校验 session 可执行、lease ID/会话/Operator/规范环境 key 绑定、未释放且未过期。
3. 读取 Broker 自己保存的最新 Observation；校验 frame、tree、前台 app 和 window。
4. 校验任务最大运行时间、最大步数、允许应用、允许域名、禁止动作和数据类别。bundle/executable/signing allowlist 只能匹配 Native Host Observation 提供的对应身份字段，不能回退为字符串相等的 app ID。
5. 计算风险；L4/无人值守 L2-L3 进入 handoff，越权动作 deny。
6. 持久化 requested action。审批请求按 session/action 幂等复用。
7. L2/L3 校验一次性 ticket；消费成功后 Storage 才允许 action 进入 `executing`。
8. 调用可信 backend；backend 必须接受同一个 AbortSignal。
9. 严格解析执行后的 Observation，持久化 after frame；noop 记录为失败。
10. 会话回到 observing。Native Host 或协议执行失败时暂停会话并释放 lease。

同一 session 只允许一个 active dispatch；并发提交直接返回 `actuator_lease_conflict`，不会让同一桌面上的两个动作交错。应用重启后，SessionManager 会从数据库枚举非终态 session，因此 Kill Switch 和退出清理也能撤销本次进程启动前遗留的会话。

Storage 的 `startExecuting()` 还会执行第二层约束：`allow` 动作不得携带 ticket；`require_approval` 动作必须引用已批准且已经单次消费、并绑定该 action 的 approval 记录。调用方不能只伪造一个 approval ID 把记录推进 executing。

## 4. 审批绑定

审批票据同时绑定：

- action 参数、policy effect、观察 frame 和 tree；
- target app、window、结构化 target；
- 排序后的数据类别；
- computer session、action ID、L2/L3 风险、审批人、有效期和随机 nonce。

Renderer 提交批准时必须回传它展示的 action/target/data-class digest，ApprovalService 在写入批准前复核，防止审批卡片与数据库对象错配。数据库只保存 nonce SHA-256；返回给受管 Operator 的明文 nonce 只可消费一次。远程设备只能批准 L2，L3 必须本机用户批准，L4 永远不能生成 ticket。

批准成功后，明文 ticket 进入 ApprovalService 的进程内一次性交接队列。CU-05 Provider loop 必须通过 `takeApprovedTicket()` 取走，重复获取返回 null；Broker 消费成功、Pause、Stop 或 Kill Switch 都会清除对应 ticket。进程崩溃后 nonce 不可恢复，启动清理会撤销数据库中 approved-but-unconsumed 的记录，不能把数据库 nonce hash 反向恢复成可执行票据。

## 5. 租约、停止和 Kill Switch

- `my_desktop` 只接受规范全局 key `my-desktop:local`；隔离浏览器/桌面分别只接受 `safe-browser:*` 与 `safe-desktop:*`。调用方不能换一个字符串绕过全局互斥。
- 数据库唯一索引保证同一环境只有一个 active lease；获取时自动释放已过期 lease。
- 心跳只能延长仍有效、未释放、同 Operator 的 lease，不能复活过期租约。
- Pause/Cancel 首先 abort 会话信号并阻止新派发，然后释放 lease。
- Broker Stop/Kill Switch 同步把 session 标为 canceled、清掉 Observation 和 pending approvals，再等待 backend `cancelSession()` 清空原生队列。
- 全局快捷键注册失败时 `ComputerKillSwitchService.isArmed()` 保持 false；My Desktop 设置层不得在此状态下启用。

重复的快捷键事件在第一次异步停止尚未结束时会被合并。触发一次 Kill Switch 会对当前进程内所有非终态 Computer Session 执行 best-effort 并行停止；单个 backend 失败不妨碍其余会话被撤销。

## 6. MCP PermissionService 映射

| 工具                                 | Permission action        | 默认行为                              |
| ------------------------------------ | ------------------------ | ------------------------------------- |
| `get_status`、`capture_app_snapshot` | `computer_observe`       | allow                                 |
| `start_task`                         | `computer_task_start`    | ask                                   |
| `resume`                             | `computer_resume`        | ask                                   |
| `pause`、`stop`、`takeover`          | 独立安全控制 action      | 始终允许，不受旧 profile/记忆拒绝阻断 |
| 未知 `spark_computer` 工具           | `computer_unknown`       | 永久 deny                             |
| click/type/keypress 等低层 MCP 工具  | `computer_direct_action` | 永久 deny                             |

普通 MCP 继续使用既有 `mcp_tool` 行为；只有 `mcp__spark_computer__*` 和 `mcp:spark_computer:*` 进入上述独立映射。PermissionService 只是任务入口的第一层权限，不能替代 Broker 的 action ticket。

## 7. 主进程 IPC 与可用性门禁

主进程已通过独立 `registerComputerUseIpc.ts` 注册协议声明的 15 个 Computer Use 通道，并由 `registerAllIpcHandlers()` 薄接线。IPC 设置默认关闭；My Desktop 只有在全局 Kill Switch 注册成功后才能持久化启用。禁用总开关或某一执行环境时，先停止受影响的活动 session，再更新设置；另一个 Renderer 必须显式 takeover 才能恢复会话。`start` 在创建 session 之前完成可信 Host 预检，生产默认不会生成不可执行的占位 session。

`list-apps` 从严格校验的原生窗口描述中去重，冲突身份按 `native_host_incompatible` 拒绝；`get-verification` 只返回 session 匹配且可通过协议解析的持久化记录。迁移 064 提供 durable Computer Use activity event 表，Broker、SessionManager、Operator 与审批路径发射完整生命周期事件；`get-timeline` 按 `computerSessionId + seq` 游标回放，实时流使用相同事件契约。事件仅包含 ID、状态、风险和诊断码，不写截图、输入正文或 AX 文本；存储失败降级为内存实时流，不反向判死已通过治理的动作。

## 8. 后续接入约束

- CU-03 下一阶段必须在 evidence sink 原子写入就绪后实现 `ComputerObserverBackend` 与 `ComputerExecutorBackend`；不得返回指向不存在 snapshot 的 Observation，也不得改变 Broker 顺序。
- CU-05 Provider Adapter 不能直接获得 backend 或 pipe，只能提交 normalized action。
- CU-06 IPC/Monitor 使用 `ComputerUseServices` 单例；批准必须携带 UI 展示的三个 digest。
- CU-07 只能根据持久化 action/observation/verification 记录完成 session，不能把模型 `done` 当成功。
- 需要让 click/invoke 低于 L2 时，必须新增可信语义证明协议、对抗测试和安全评审；不得直接修改动作下限表。
