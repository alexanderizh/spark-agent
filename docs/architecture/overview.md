# SparkWork 运行架构

> 状态: 已落地 | 最后核对: 2026-09-24

这份文档是 SparkWork（仓库名 `spark-agent`）的工程事实入口。它描述当前代码已经形成的运行边界、启动顺序、一次 Agent 任务如何流转，以及新增功能应该落在哪一层。

## 一句话模型

SparkWork 是一个本地优先的 Electron 桌面应用：React 渲染器负责界面，preload 只暴露受控的 `contextBridge`，Electron 主进程负责系统能力与生命周期，`@spark/agent-runtime` 负责会话和 Agent 编排，`@spark/storage` 负责本机 SQLite，`@spark/agent`（`spark-engine/`）提供独立的执行内核与 CLI 载具。

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Electron Renderer                                                     │
│ React UI · code/terminal/browser/canvas · local view state             │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ window.spark / contextBridge
┌──────────────────────────────▼───────────────────────────────────────┐
│ Electron Main                                                         │
│ lifecycle · BrowserWindow · IPC · files · Git · terminal · windows    │
└───────────────┬──────────────────────────────┬───────────────────────┘
                │ typed IPC                    │ local services
┌───────────────▼────────────────┐  ┌──────────▼────────────────────────┐
│ @spark/agent-runtime            │  │ @spark/storage + @spark/shared   │
│ sessions · engines · tools      │  │ SQLite/WAL · repositories · vault │
│ providers · MCP · skills        │  │ paths · logging · shared schemas  │
│ permissions · teams · workflows │  └──────────────────────────────────┘
└───────────────┬────────────────┘
                │ executor / SDK boundary
┌───────────────▼──────────────────────────────────────────────────────┐
│ @spark/agent / spark-engine                                            │
│ turn machine · tool runner · permissions · events · CLI/TUI · HTTP serve │
└───────────────────────────────────────────────────────────────────────┘
```

模型服务、MCP 服务器、浏览器、外部连接和多媒体 Provider 都属于边界外的能力。它们通过受控适配器进入运行时，不能直接穿透渲染器或绕过权限闸门。

## 进程与包边界

| 层             | 代码位置                                   | 责任                                                                          | 不应该做什么                                              |
| -------------- | ------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| 桌面壳         | `apps/desktop/src/main`                    | Electron 生命周期、窗口、IPC 注册、文件/终端/Git/系统集成、启动与退出清理     | 不在 renderer 里直接访问 Node 或数据库                    |
| 预加载桥       | `apps/desktop/src/preload`                 | 通过 `contextBridge` 暴露最小、可审计的 API                                   | 不把 `ipcRenderer`、Node 全量对象或密钥暴露给页面         |
| 界面           | `apps/desktop/src/renderer`                | 对话、代码、终端、浏览器、画布、设置和审查视图                                | 不自行实现持久化、Provider 调用或系统命令执行             |
| Agent 编排     | `packages/agent-runtime`                   | 会话、轮次、执行器、Provider、MCP、Skills、权限、工作流、团队、调度、媒体任务 | 不直接操纵 Electron 窗口；通过服务接口和 IPC 使用宿主能力 |
| 存储           | `packages/storage`                         | SQLite 连接、迁移、Repository、事件和领域数据                                 | 不在业务包里拼接未经约束的 SQL；凭据只保存引用            |
| 共享契约       | `packages/protocol`、`packages/shared`     | IPC/Event/领域 schema、错误、常量、日志、密钥/路径辅助                        | 不放具体 UI 行为或平台特有实现                            |
| 执行内核       | `spark-engine`                             | turn machine、工具运行、权限、事件账本、调度、CLI/TUI 与 HTTP serve           | 不依赖桌面 renderer；保持可独立构建和验证                 |
| 扩展 SDK       | `packages/plugin-sdk`、`packages/tool-sdk` | 插件、工具包和外部扩展的类型/运行契约                                         | 不绕过宿主的权限、审计和版本边界                          |
| 官网与用户文档 | `apps/website`                             | 自有域名官网、下载页、用户文档、预渲染 SEO 内容                               | 不把官网构建产物当作 GitHub Pages 的工程手册源            |

## 桌面端启动顺序

主进程入口是 `apps/desktop/src/main/index.ts`。真实启动可以按下面的顺序理解：

1. 在任何 `userData` 消费者运行前，根据开发/生产 profile 隔离数据目录，并安装错误、退出和日志保护。
2. 在 `app.whenReady()` 之前注册特权协议；初始化单实例、窗口策略和系统边界。
3. 应用就绪后打开或创建 SQLite 数据库，执行迁移前备份、迁移和必要的恢复检查。
4. 初始化会话、Provider、MCP、浏览器、终端、Computer Use、可选能力、更新、通知、远程连接和后台维护服务。
5. 注册集中式 IPC handlers，确保 renderer 只能走已声明的通道。
6. 创建安全配置的 `BrowserWindow`：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，再加载 preload 与 renderer。
7. `ready-to-show` 后显示窗口；退出时按注册顺序停止任务、释放服务、关闭数据库并留下可诊断日志。

开发环境默认使用隔离的 `*-dev` 数据目录；生产包使用 Electron 的正式 `userData` 目录。数据库文件通常是 `{userData}/spark.db`，SQLite 使用 WAL，迁移版本单调递增。

## 一次 Agent 任务如何流转

```text
用户消息
  │
  ▼
Renderer 输入/队列/计划审批
  │ typed IPC
  ▼
Main IPC → Session Service → Turn Registry
  │                         │
  │                         ├─ 选择引擎（Claude SDK / Codex / Spark Engine）
  │                         ├─ 合并 Provider、Model、Skill、Rule、MCP 上下文
  │                         └─ 建立权限、预算、取消、重试和审计边界
  ▼
Executor / spark-engine turn machine
  │
  ├─ 生成模型请求
  ├─ 请求工具或外部能力
  │    └─ 权限闸门 → 一次/会话允许或拒绝 → Tool Result Governance
  ├─ 写入事件、用量、性能和 checkpoint
  └─ 流式回传文本、工具状态、问题向导和产物
  │
  ▼
Storage Repository / 文件系统 / workspace
  │
  ▼
IPC 事件 → Renderer 会话时间线、审查面板、任务面板和通知
```

重要的控制点：

- 会话服务是“轮次”与“执行器”的连接点；不要从 UI 直接调用 SDK。
- 工具调用先过权限和策略，再进入本机命令、文件、浏览器、Git、MCP 或多媒体能力。
- 事件和结果要能恢复：流式输出、用量、性能、审计、checkpoint 与失败原因分别有持久化或可重建路径。
- 长任务必须支持取消、暂停、重试、断点继续和关闭清理；只增加“发起请求”而没有终止路径的功能不完整。

## 数据与安全边界

| 数据                                      | 默认位置/通道                      | 规则                                                                  |
| ----------------------------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| 会话、项目、Provider 元数据、工作流、任务 | 本机 SQLite                        | 通过 `@spark/storage` Repository 和迁移访问                           |
| API Key、登录凭据                         | 系统 keychain / 加密凭据库         | SQLite 只保存 `keychain_ref` 等引用；日志、Issue、Wiki 不写入真实密钥 |
| 项目文件和生成产物                        | 用户 workspace、项目目录、资产目录 | 通过路径保护、权限策略和 checkpoint 管理                              |
| Agent 事件、用量和审计                    | SQLite 事件/账本与运行时日志       | 需要支持恢复、追踪和问题排查                                          |
| 可选大体积运行时                          | 受完整性校验的能力目录             | 安装、修复、升级和卸载遵守版本/哈希/路径防护                          |
| 外部模型、MCP、连接器                     | Provider/adapter + IPC 服务        | 不默认信任；超出本地边界的动作必须可见、可拒绝、可审计                |

三个不能被弱化的 Electron 安全约束：

1. renderer 不启用 Node integration。
2. preload 只暴露显式、最小的 `contextBridge` API。
3. 文件、命令、网络、桌面控制和外部工具都必须经过权限/策略层。

## 仓库地图

```text
spark-agent/
├── apps/desktop/       Electron 桌面端：main / preload / renderer
├── apps/website/       旧官网（已停更，见 apps/website/DEPRECATED.md），新官网在 edu-web 仓库
├── packages/
│   ├── agent-runtime/  Agent 会话与能力编排
│   ├── protocol/       IPC、事件和领域 schema
│   ├── storage/        SQLite、迁移和 Repository
│   ├── shared/         跨进程常量、日志、错误与凭据辅助
│   ├── plugin-sdk/     插件契约
│   └── tool-sdk/       工具扩展契约
├── spark-engine/       可独立构建的执行内核、CLI/TUI、serve
├── scripts/            CI、协议、文件大小、发布和运行时检查
├── docs/               开发设计、运行时说明、评审和治理文档
└── .github/            CI、发布工作流、Issue/PR 模板和 Pages
```

## 性能、并发与路由治理

这一层横跨 `packages/agent-runtime` 与 `apps/desktop`，是「任务能跑完」与「整机不被拖垮」之间的边界。当前有三块：

| 能力                                 | 落点                                                                           | 当前状态                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 资源监控（`resource-monitor/`）      | agent-runtime 服务 + `settings` 的 `performance` category + 设置 → 系统 → 性能 | 已落地：2 s 采样、六类判级指标、按宿主机内存与 CPU 核数换算的三档阈值、滞回、`resource_pressure_events` 持久化与推流 |
| 派发闸门（`dispatch-governor/`）     | agent-runtime 服务，成员派发前 `acquire`                                       | 已落地：全局子进程预算、宿主封顶、成员槽下限、成员并发硬顶、嵌套池与逃生阀                                           |
| 自动路由（`auto-router.service.ts`） | agent-runtime 服务 + `provider_profiles` 的 `provider_type = 'auto-router'`    | 已落地：分流器逐轮定强度 → 宿主在轮次前替换 provider/model，失败按 `timeout/http/schema/rule/no_executor` 降级       |

必须知道的边界（写在这里以免再次误读代码）：

- **压力级别目前只做观测与通知。** `DispatchGovernor.setPressureLevel` 的注释是「M2 预留：本轮只记录档位」，`acquire` 不读该字段；设置页里「按压力限流 / 暂停派发」的文案描述的是目标行为，**不是当前的准入实现**。
- **真正生效的调控是固定并发上限**：预算是子进程数的物理上限，一个 permit = 一次成员执行 = 至多一个 CLI 子进程；容量收缩只影响新准入，不撤销在逃 permit。
- 资源监控数据**不出网**，只落本机 SQLite 与内存环形缓冲。

用户向说明见 edu-web 文档中心的「性能监控与保护」「自动路由」两篇（`src/pages/site-docs/content/`）。

## 新功能落位规则

| 需求                | 首选落点                                       | 最少验证                                 |
| ------------------- | ---------------------------------------------- | ---------------------------------------- |
| 新的界面/面板       | `apps/desktop/src/renderer`                    | 组件测试、renderer typecheck、交互 smoke |
| 新的桌面能力        | main service + typed IPC + preload API         | IPC 契约测试、权限/路径测试、退出清理    |
| 新的 Agent 行为     | `packages/agent-runtime` 或 `spark-engine`     | 运行时单测、取消/重试/错误路径、事件恢复 |
| 新的数据字段        | `packages/storage/src/migrations` + Repository | 迁移验证、旧数据库启动、回滚/备份路径    |
| 新的模型/媒体渠道   | Provider/manifest/adapter 层                   | 参数归一化、密钥投放、能力枚举和失败降级 |
| 新的 MCP/Skill/插件 | 对应 SDK/registry/runtime 层                   | 信任、权限、版本、导入/卸载和审计        |
| 官网/用户文档       | `apps/website`                                 | typecheck、build、GEO 检查、预览深链     |
| 工程架构/治理文档   | `docs/architecture`、`docs/operations`         | 更新状态行、核对日期和读者可执行性       |

## 构建与发布关系

| 流程           | 入口                          | 产物/目的                                                     |
| -------------- | ----------------------------- | ------------------------------------------------------------- |
| CI             | `.github/workflows/ci.yml`    | 类型检查、lint、文件大小、Spark engine 和包级验证             |
| 桌面发布       | `publish-desktop-release.yml` | macOS/Windows/Linux 安装包与 GitHub Release                   |
| CLI 发布       | `publish-spark-cli.yml`       | `spark-cli-releases` 分支中的 tarball、安装器和 `latest.json` |
| 自有官网       | `publish-website.yml`         | `apps/website` Docker 镜像和自有服务器部署                    |
| 工程手册 Pages | `deploy-pages.yml`            | `docs-site/` 静态 artifact，展示架构、治理和贡献流程          |

GitHub Pages 与自有官网是两条有意分开的发布链：官网面向终端用户和下载，Pages 面向贡献者、维护者和仓库治理。不要把 Pages 的发布失败当成桌面安装包发布失败，也不要在 Pages 里复制版本中心的敏感配置。

## 变更前检查清单

- 先确认改动属于哪个进程/包边界，以及是否需要新增 IPC、事件或迁移。
- 任何新的外部能力都要说明凭据如何进入、权限如何审批、失败如何恢复。
- 任何持久化结构都要配迁移、备份兼容性和旧数据启动验证。
- 任何长任务都要补取消、重试、关闭和断点路径。
- 文档类计划/设计文件在标题后第一段保留状态与最后核对日期。
- 提交前运行与变更包最接近的 typecheck/lint/test；Pages 变更至少检查 artifact 文件齐全。

## 相关入口

- [GitHub 治理与项目板](../operations/github-governance.md)
- [发布与 GitHub Pages 运维](../operations/release-and-pages.md)
- [桌面端用户/开发文档](../../apps/website/src/content/docs-pages/desktop-guide.tsx)
- [Spark engine 运行时说明](../spark-engine-runtime.md)
- [Spark engine 管理进程说明](../spark-engine-managed-processes.md)
