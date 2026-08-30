# Tool Studio 体验升级任务状态

> 状态: 已落地 | 最后核对: 2026-08-31

## 目标

在不改变现有内置工具、MCP、Skills 与 Provider 主干行为的前提下，将已落地的自定义工具配置能力升级为 Tool Studio：支持草稿与稳定版本分离、原子发布与回滚、Inspector/Trace、真实会话解释和本地运行观测；同时完成独立 Worker Host 的安全与打包 spike，为后续 TypeScript 工具热重载提供可验证边界。

## 当前进度

- [x] 完成竞品公开能力研究和体验升级方案评审。
- [x] 确认启动时工作树边界；收尾阶段发现画布、Agent 创建工具、Worker Runner 等并行改动后，按文件与错误归属隔离核对。
- [x] 复核协议、存储、执行器、运行时、扩展中心与会话调用链影响面（GitNexus 索引过期，已按项目规则降级为源码、调用点、测试与 diff）。
- [x] 实现草稿 / 发布版本与原子发布、回滚。
- [x] 实现 Tool Studio 工作台与渐进式创建入口。
- [x] 修正创建入口语义：顶层与空态保持通用，图像理解降为二级参考模板。
- [x] 实现 Inspector、Trace、运行记录与图像理解路由解释。
- [x] 完成会话内宿主视觉事件、Trace 跳转和 Tool Studio 宿主路由检查；明确不冒充聊天模型最终回答验证。
- [x] 完成 Worker Host 安全与打包 spike。
- [x] 完成聚焦测试、类型检查归属核对、生产构建与五轴代码审查。

## 已确认决策

- 现有内置工具和后续内置工具保持原样，自定义工具是增量热插拔扩展层。
- 首个端到端参考用例继续使用现有「自部署图像理解」Provider。
- 图像理解不得成为顶层按钮、空状态默认入口或协议扩展方向；任意工具能力由通用运行适配器与能力声明承载。
- UI 使用扁平分隔线、三栏工作台和渐进式披露，不使用卡片墙、统计卡、渐变或装饰性动效。
- 草稿测试不得影响当前发布版本；发布失败必须保留旧版本。
- 第三方代码不得进入 Electron Main、Renderer 或 Agent Runtime 进程。
- Node Permission Model 不限制网络；P1 任意 TypeScript 执行必须先完成平台级默认断网和 Broker 能力代理。
- P1 spike 通过了独立进程、IPC、文件/子进程/Worker 默认拒绝、超时、heap/OOM 与崩溃隔离；跨平台断网与资源硬限制仍是开发门禁。

## 最终验证

- 聚焦测试：Protocol 45、Agent Runtime 64、Storage Repository 11、Desktop 15、v88 → v89 升级 1，合计 136 项通过。
- 兼容性：真实升级测试确认旧工具、旧 Trace 与 v1 快照无损迁移。
- 静态质量：目标 ESLint 零错误，Prettier、`git diff --check` 通过。
- 构建：Desktop 生产构建退出码 0，Renderer 转换 17,728 个模块；Electron `better-sqlite3` ABI 已恢复。
- TypeScript：Protocol、Storage typecheck 通过；Agent Runtime 仅剩并行 Agent 创建工具的 `mcp-project` 测试类型错误，Desktop 仅剩并行画布的 `CanvasFlowEdge` / `CanvasStage` 类型错误，均不属于本任务。
- 审查：完成正确性、可读性、架构、安全和性能五轴审查，已复核修正的缺陷均有源码或回归测试证据。

## 下一步

1. 由用户在真实应用中手动验收扩展中心完整交互、浅色 / 深色、窄窗口和真实“自部署图像理解”调用。
2. P1 在三平台默认断网、Broker、资源限制和 Runtime 供应链门禁完成前，继续禁止开放任意 TypeScript 工具执行。
3. 等并行 Agent 创建工具与画布任务各自修复其 typecheck 后，再执行一次共享工作树四包全绿确认。
