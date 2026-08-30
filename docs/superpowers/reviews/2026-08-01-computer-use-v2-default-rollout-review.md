# Computer Use V2 · 默认启用与运行期回退审查

> 日期: 2026-08-01 | 阶段: Phase 7 默认放量 | 结论: V2 核心能力默认启用，独立回退保留

## 1. 结论

Host Supervisor、持续捕获、增量可访问性树和动作批处理从 opt-in 实验路径提升为默认产品路径。此前四项虽已实现并通过阶段测试，但默认关闭导致普通用户持续走旧链路，无法获得 V2 的可靠性、延迟和批处理收益。

本次只改变统一 flag 注册表的默认值，不删除旧路径，也不改变环境变量覆盖和运行期回退。任一功能仍可通过对应 `SPARK_COMPUTER_USE_V2_*` 环境变量设置 `0`、`false`、`no` 或 `off` 显式关闭。

## 2. 三遍审查

### 第一遍：功能边界

- Host Supervisor 负责持久连接、心跳和一次有界重启；回退时释放 Supervisor 连接并切回基础单连接。
- 持续捕获只增加向后兼容的 observe 字段；平台长会话失败最多回退一次单帧，预算超标只关闭该 flag。
- 增量树只改变 full/diff 传输，完整元素引用与 stale-tree 约束保持不变；baseline 不匹配时回到 full。
- batch 只影响模型决策粒度；每个动作仍逐步经过观察新鲜度、Broker policy/approval、Native Host 目标绑定与执行结果校验。

### 第二遍：回退与安全

- `ComputerUseV2FlagStore.disableForRuntime` 只关闭关联功能，并在 snapshot 中记录原因；应用重启恢复配置默认值。
- Rollout Controller 对 Host 崩溃、制品失败、动作错误、接管 P99 和持续捕获预算使用有界样本与最小样本门槛，单次抖动不会触发回退。
- 环境变量显式关闭优先于默认值；旧 wrapper 调用方继续读取统一 store。
- click/type 风险基线、T01 升档、敏感数据、handoff、审批、证据与签名/协议 fail-closed 均未修改。

### 第三遍：兼容与验证

- 默认值测试覆盖四项核心能力全部启用。
- 环境 opt-out 测试覆盖 `off` 解析，既有 runtime rollback 测试继续证明配置不会被突变。
- 完整 Computer Use、协议、agent-runtime、desktop typecheck/build 与 Native Host 双端测试在提交前执行；外部真机与百分比运营数据仍作为发布签收证据，不伪造为本地验证。

## 3. 回滚

可整体 revert 本提交，或仅用对应环境变量关闭单项。运行时阈值超标时系统自动关闭关联 flag，不关闭整个 Computer Use，也不绕过 Broker。
