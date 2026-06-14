# Spark Agent

Spark Agent 是一个本地优先的 AI Agent 桌面工作台，面向开发者、高级用户和团队协作场景。它以 Electron + React + TypeScript 构建，目标是把多模型 Provider、Claude Agent SDK / Codex SDK、MCP、Skills、工作流编排、多 Agent 执行、权限治理和本地资产管理整合到一个可观察、可扩展、可审计的桌面应用中。

> 当前项目仍处于快速开发阶段，API、数据结构和部分交互可能继续调整。欢迎 Star、Issue 和 PR。

## 特性

- 本地优先：会话、项目、配置和运行数据优先保存在本机。
- 多 Agent 运行时：围绕 Claude Agent SDK、Codex SDK 和通用 Provider Adapter 设计统一 Agent Runtime。
- MCP 与 Skills：支持把外部工具、数据源和可复用能力接入 Agent 工作流。
- Provider 管理：支持配置文本、多模态、图片、语音、视频等模型能力，并通过受控运行时调用。
- 多媒体生成：提供图片、多媒体 Provider Adapter 设计，面向画布和 Agent 工具调用输出本地资产。
- 可视化工作台：围绕会话、项目、工作流、画布、Provider、设置等模块组织桌面端体验。
- 本地存储：使用 SQLite / better-sqlite3 管理结构化数据，使用系统凭据存储保存敏感信息。
- 跨平台桌面：基于 Electron Builder，面向 macOS、Windows 和 Linux 打包。

## 技术栈

- 桌面框架：Electron、electron-vite、electron-builder
- 前端：React 19、TypeScript、Tailwind CSS、@lobehub/ui、antd、XYFlow
- 后端运行时：Node.js、better-sqlite3、keytar
- Agent / AI：Claude Agent SDK、OpenAI SDK、MCP、Provider Adapter
- 工程化：pnpm workspace、Vitest、Playwright、ESLint、Prettier

## 目录结构

```text
.
├── apps/
│   └── desktop/          # Electron 桌面应用
├── packages/
│   ├── agent-runtime/    # Agent Runtime、Provider、MCP、媒体能力
│   ├── protocol/         # IPC、事件协议、Zod schemas
│   ├── shared/           # 通用工具、日志、错误、KeyStore
│   └── storage/          # SQLite 存储、迁移、Repository
├── docs/                 # 架构、设计、发布和开发文档
├── skills/               # 项目内 Skills 资源
└── images/               # 项目图片资源
```

## 环境要求

- Node.js >= 22
- pnpm >= 10
- Git

Windows 用户建议安装 Visual Studio Build Tools，以便 `better-sqlite3`、`keytar` 等原生依赖在需要时能够正确构建。

## 快速开始

```bash
git clone https://github.com/alexanderizh/spark-agent.git
cd spark-agent
pnpm install
pnpm dev
```

## 常用命令

```bash
# 启动桌面端开发环境
pnpm dev

# 类型检查
pnpm typecheck

# 运行单元测试
pnpm test:unit

# 运行全部测试
pnpm test

# 代码检查
pnpm lint

# 格式化
pnpm format

# 构建桌面端
pnpm build
```

桌面端打包命令位于 `apps/desktop/package.json`：

```bash
pnpm --filter @spark/desktop build:win
pnpm --filter @spark/desktop build:mac
pnpm --filter @spark/desktop build:linux
```

## 文档

- [Desktop Agent Development Guide](docs/desktop-agent-development-guide.md)
- [Agents Workflows](docs/agents-workflows.md)
- [Remote Connections](docs/remote-connections.md)
- [Image Generation Providers](docs/image-generation-providers.md)
- [Multimedia Model Providers](docs/multimedia-model-providers.md)
- [GitHub Release Auto Update](docs/github-release-auto-update.md)

更多架构决策可以查看 [docs/adr](docs/adr)。

## 开发约定

- 使用 pnpm workspace 管理 monorepo。
- 前端 UI 优先使用 `@lobehub/ui`，其次使用 `antd`。
- 不新增或恢复 Arco Design、Radix、`@spark/ui-kit` 等已移除 UI 栈。
- 敏感凭据应通过系统凭据存储管理，不应写入日志、前端状态或仓库文件。
- 提交 PR 前请尽量运行 `pnpm typecheck`、`pnpm lint` 和相关测试。

## 贡献

欢迎通过 Issue 和 Pull Request 参与贡献。建议在提交较大改动前先创建 Issue 说明背景、目标和设计取舍，方便讨论和减少返工。

适合贡献的方向包括：

- Agent Runtime 与 Provider Adapter
- MCP / Skills 集成
- 桌面端交互体验
- 多媒体模型能力
- 测试、文档和示例
- 跨平台打包与发布

## 安全

如果你发现安全问题，请不要在公开 Issue 中披露敏感细节。可以先通过仓库维护者可用的私有联系方式沟通，确认影响范围后再公开修复说明。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
