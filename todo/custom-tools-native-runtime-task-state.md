# 原生自定义工具运行时任务状态

> 状态: 已完成 | 最后核对: 2026-08-31

## 目标

把自定义工具从“受管 MCP + HTTP 声明”纠正为 SparkWork 原生一等能力：工具定义、版本、权限、执行、追踪和 Agent 目录均由宿主管理；MCP 只允许作为模型引擎的末端兼容适配器或外部生态导入方式。

## 当前边界

- 另一会话继续负责 Tool Studio 既有三栏体验、Trace 与 Provider Vision 展示；本任务不回滚其改动。
- 本任务新增原生 Custom Tool Catalog、代码运行适配器和薄接线，并扩展 Studio 的通用代码工具编辑能力。
- 用户代码默认作为“受信任本地代码”运行，必须先保存/测试/发布并由用户确认启用；不宣称已经达到不可信代码沙箱等级。
- Worker 进程不接收 Keychain、完整环境变量或 Electron/Agent Runtime 对象；首版只允许纯计算和显式调用已发布的其他自定义工具。

## 实施计划

- [x] 新增 `code` 工具协议、原生目录和独立 Worker Host。
- [x] 让原生目录接入 Agent 工具快照，移除 `spark_custom_tools` 受管 MCP 注册。
- [x] 让 Agent authoring 能校验、创建、测试、发布代码工具。
- [x] 在 Tool Studio 提供 TypeScript 源码、依赖工具白名单和测试入口。
- [x] 更新方案文档，完成聚焦测试、typecheck、构建和五轴审查。

## 已确认影响

- 协议与持久化：中高，采用新增判别联合成员保持旧数据兼容。
- Agent 工具目录与 Session 接线：高，只做可选数据源和下一轮快照刷新。
- 旧受管 MCP 迁移：中，只清理应用自己创建的 `spark_custom_tools` 行，不触碰用户 MCP。
- Worker Host：高风险边界，第三方代码只在独立 Node 进程执行，超时/崩溃不得阻断会话。

## 下一步

开发与审查闭环已完成（2026-08-31）。最终验证事实：

- 迁移：089「088 旧库升级 + 全新建库」双路径测试 4 项通过；89 个迁移内存干跑通过。
- 聚焦测试：Protocol 305、Storage 自定义工具 15、Agent Runtime 自定义工具链 65 项全部通过。
- typecheck：Protocol、Storage、Agent Runtime 通过；Desktop 仅剩并行会话画布文件（CanvasFlowEdge/CanvasStage）报错，自定义工具文件零错误，未越权修改。
- 打包：构建钩子改为同步式清理（源删除的工具不再残留 out/ 并进安装包）；Desktop 生产构建通过，runner 与源码逐字一致，旧 `custom-tools-mcp-server.mjs` 已从产物清除。
- 五轴审查：code 执行器超时/取消/协议帧边界、runner 单次调用守卫与 stdout 隔离、原生目录仅暴露已发布非 vision 工具、旧受管 MCP 仅清理应用自建行——无遗留阻断项。
- 本轮尚未提交；真实代码工具的端到端体验（Studio 内编写 → 测试 → 发布 → Agent 调用）仍需用户在应用内手动验收。

## 会话边界

- 另一会话负责 Tool Studio 三栏体验、Trace 与 Provider Vision 展示的并行改动仍未提交，本任务不触碰其文件。
- better-sqlite3 ABI 已在测试后恢复 Electron。
