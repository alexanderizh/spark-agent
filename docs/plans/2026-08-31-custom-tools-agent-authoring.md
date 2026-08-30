# SparkWork Agent 对话创建自定义工具方案

> 状态: 已废弃 | 最后核对: 2026-08-31

本方案中“任意逻辑生成 MCP 项目”的决策已被证明不符合产品目标，现由 [原生自定义工具运行时](./2026-08-31-custom-tools-native-runtime.md) 取代。保留本文一个版本周期仅用于解释 0.11.27 到原生 Runtime Catalog 的迁移背景；新的 Agent authoring 直接创建 `type=code` 工具草稿，不再把 MCP 作为默认实现。

## 1. 目标

用户可以直接对任意具备平台管理能力的 Agent 描述想要的工具，由 Agent 完成定义、校验、草稿保存、测试、发布和启停。产品入口始终是通用“自定义工具”，图像理解只是一份普通模板和验收用例。

## 2. 运行适配器

首版按能力而不是业务名称路由：

- 声明式 HTTP：进入 Tool Studio，由宿主执行器提供模板校验、密钥引用、SSRF、重定向、超时和响应大小治理。
- Provider Vision：仅作为现有兼容模板，继续复用 Provider 与 Keychain。
- 任意本地或复杂逻辑：使用标准 MCP 项目。Agent 可在工作区生成、校验项目，并通过平台 MCP 管理能力以禁用状态注册；用户确认后启用。
- 沙箱 TypeScript Worker：保留为后续增强。OS 级默认断网和 Broker 未完成前不得开放。

MCP 路线不是把工具限定为 MCP 业务类型，而是复用标准通用运行协议。一个 MCP 项目可以提供任意数量、任意领域的工具，现有和未来内置工具保持不变。

## 3. Agent 管理闭环

平台管理 MCP 新增只面向自定义工具的管理能力：

1. `custom_tools_guide`：返回支持路径、安全边界和标准定义示例。
2. `custom_tools_list/get`：读取现状，避免重复创建和猜测配置。
3. `custom_tools_validate`：只读校验完整草稿，不落库。
4. `custom_tools_create_draft/save_draft`：保存禁用草稿，不改变 Agent 当前稳定工具面。
5. `custom_tools_test`：复用正式执行器；写操作必须显式确认。
6. `custom_tools_publish`：原子发布稳定版本；首次发布会进入 Agent 工具面，后续发布沿用当前启用状态。
7. `custom_tools_set_enabled`：启用必须显式确认，禁用可直接执行。
8. `custom_tools_rollback`：回滚到历史稳定版本。
9. `custom_tools_delete`：破坏性操作，必须显式确认。

所有写操作复用桌面端同一个 `CustomToolService` 实例，保证数据库、Keychain 状态、UI 推流和 `spark_custom_tools` 热刷新一致，不创建第二套仓库或旁路状态。

## 4. 对话规则

- Agent 先读取指南和现状，再生成定义；不得凭空猜 API 字段、鉴权方式或副作用等级。
- 创建永远先落草稿；用户没有明确要求时不得测试付费/写操作、首次发布或重新启用。首次发布会进入 Agent 工具面，因此必须明确说明并确认。
- 密钥值不作为管理工具参数。Agent 只能声明 `secretRef`，随后引导用户在扩展中心安全表单填写。
- HTTP/OpenAPI 工具可直接进入 Tool Studio；需要自定义代码时生成 MCP 项目并先禁用注册。
- Agent 必须明确区分“草稿已创建”“测试通过”“已发布”“已启用”，不能把其中一步包装成全部完成。

## 5. 安全与兼容

- 新平台工具均为加法改动，不改变现有 Skills、MCP、Provider、Agent 和 Workflow 工具语义。
- 平台 MCP 调用继续经过现有会话权限审批；启用、删除和有副作用测试再增加业务层确认字段。
- 导入或生成的 MCP 代码是受用户信任的本地项目，不宣称具备沙箱隔离；启用前必须让用户检查权限与命令。
- 不允许经 Agent 管理接口写入、返回或日志记录密钥明文。
- Provider Vision 的宿主确定性路由保持现状，不影响通用创建入口和其他工具。

## 6. 验收标准

- Agent 能创建一个 HTTP 工具草稿，校验错误能精确返回，发布前不会进入 Agent 工具面。
- Agent 能在用户确认后首次发布进入工具面，`spark_custom_tools` 热刷新无需重启应用。
- 写操作测试、启用和删除缺少确认时会被服务端拒绝。
- Agent 无法通过这些工具写入密钥值。
- Agent 能说明并执行“生成本地 MCP 项目 → 禁用注册 → 检查连接/工具清单 → 用户确认启用”的通用工具路径。
- 现有图像理解工具、HTTP 工具、Provider、MCP 和 Tool Studio P0 行为不回归。

## 7. 实施结果

- 平台管理 MCP 已增加 `custom_tools_*` 11 个工具，并同步进入 Claude SDK / Codex 可见的公共工具清单。
- Desktop 会话装配复用 IPC 与 `CustomToolsRuntimeService` 持有的同一个 `CustomToolService`，Agent 保存、发布和启停会沿现有事件链刷新 Tool Studio 与受管工具面。
- `CustomToolAuthoringService` 作为独立边界负责定义校验、禁用草稿、确认门和响应脱敏；不会向 Agent 暴露密钥写入接口。
- Agent 直建适配器与正式执行器保持一致，仅接受 HTTP 与普通 Provider Vision 模板；协议中尚未开放的 SQL / Command / Prompt 会在 validate 阶段明确引导到 MCP 项目，不再出现“校验通过但创建失败”。
- `secretRefs` 只接受 `custom-tool:<toolId>:<name>` 规范引用；历史或异常记录返回 Agent 前也会按密钥位名称归一化，避免把引用值当作可见配置泄露。
- Agent 真实测试结果会用本次实际解析的 Keychain 值做精确替换，并对常见 Authorization / token / API key 回显做二次脱敏，防止测试服务回显请求头后把密钥送回模型。
- Agent 列表入口默认最多返回 50 条、允许显式提高到 100 条，并返回 `total/truncated`，避免工具数量增长后无界占用模型上下文；Tool Studio 自身列表不受该限制。
- platform-manager skill 与会话系统提示已经写明通用流程：图像理解不具备默认入口地位；任意本地逻辑走禁用注册、检查后确认启用的受信任 MCP 项目。

代码型工具仍不在 Electron / Agent Runtime 内执行。独立 TypeScript Worker 的默认断网与 Broker 门禁尚未满足，因此本次“任意工具”通过标准 MCP 协议实现，不宣称已经交付任意 TypeScript 沙箱。

## 8. 验证记录

- Agent authoring facade、Platform Bridge 与平台 MCP 契约共 15 项测试通过。
- 平台 MCP 工具定义与 SDK allow-list 数量、名称完全同步；打包输出中的 `platform-management-mcp-server.mjs` 与源码一致。
- 目标 ESLint（0 error；公共 Platform Bridge 保留既有 warning）、Prettier 与 `git diff --check` 通过。
- Desktop 生产构建通过；89 个迁移文件静态校验通过，最终 `platform-management-mcp-server.mjs` 打包副本与源码逐字一致，主 bundle 同时包含新增 allow-list 与对话规则。
- Agent Runtime 全包 typecheck 当前只剩另一并行 Tool Studio 测试 `custom-tool-service.test.ts:340` 的 `unknown` 收窄错误；本任务文件没有 TypeScript 诊断，未越权修改并行会话文件。
- Desktop Node/Main tsconfig 通过；完整 Desktop typecheck 当前被另一并行画布改动 `CanvasFlowEdge.tsx:62`、`CanvasStage.tsx:2624` 阻断，生产构建本身通过。
