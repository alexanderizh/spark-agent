# Agent 对话创建自定义工具任务状态

> 状态: 已落地 | 最后核对: 2026-08-31

## 目标

让 SparkWork Agent 能通过平台管理工具完成自定义工具的指南获取、定义校验、草稿创建与更新、测试、发布、启停和回滚；图像理解只保留为普通模板。任意本地逻辑通过受用户信任的 MCP 项目接入，未完成 OS 级沙箱前不开放伪安全的任意 TypeScript Worker。

## 并行边界

- 另一会话正在修改 Tool Studio UI、版本化存储、Trace 与 Provider Vision 会话展示。
- 本任务不接管 `CustomToolService`、Repository 和 Tool Studio 主组件的现有业务实现。
- 新能力主要落在 Platform Bridge、Platform Management MCP、Session 注入与独立 Agent authoring facade。

## 当前进度

- [x] 核对共享工作树和另一会话任务状态。
- [x] 确认 Worker Host 网络隔离门禁尚未满足。
- [x] 确认平台管理 MCP 是所有 Agent 共用的管理能力入口。
- [x] 实现 Agent authoring facade 与平台桥工具。
- [x] 注入共享 CustomToolService，保证保存后触发同一热刷新链路。
- [x] 更新 Agent 系统提示和 platform-manager 技能说明。
- [x] 补契约测试并完成正确性、架构、安全、性能与兼容性审查。

## 安全决策

- Agent 只能写入密钥引用名，不能通过自定义工具管理接口写入密钥值。
- 新工具先创建为禁用草稿；发布不等于启用。
- 测试写操作、启用与删除必须带显式确认字段。
- 任意本地代码以受信任 MCP 项目承载，先禁用注册、完成检查后由用户确认启用。
- 不把普通 Node 子进程描述为安全沙箱，不绕过现有 MCP 权限审批。

## 验证结果

- Agent authoring facade 6 项、Platform Bridge 2 项、平台 MCP 契约 7 项，共 15 项通过；覆盖服务端密钥回显脱敏与列表结果上限。
- 目标 ESLint（0 error；公共 Platform Bridge 保留既有 warning）、Prettier、`git diff --check` 通过。
- 平台 MCP 工具定义与 SDK allow-list 同步；Desktop 生产构建通过，打包脚本与源码一致。
- 全包 typecheck 当前仅被另一会话 `custom-tool-service.test.ts:340` 的 `unknown` 收窄错误阻断；本任务文件没有 TypeScript 诊断，未改动该并行文件。
- Desktop Node/Main tsconfig 通过；完整 Desktop typecheck 仅被另一并行画布改动 `CanvasFlowEdge.tsx:62`、`CanvasStage.tsx:2624` 阻断。

## 后续边界

- Tool Studio UI、Trace、版本化存储与 Provider Vision 会话展示继续由另一会话收口。
- 真正的 TypeScript Worker Developer Mode 仍需完成三平台默认断网、Broker、资源限制和真机验证门禁；当前任意本地逻辑使用受信任 MCP 项目。
