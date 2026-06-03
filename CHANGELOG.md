# Spark Agent Changelog

所有重要变更均记录在此文件中。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

---

## [Unreleased] - Skill 商店开发中

### Bug 修复

- **应用退出时关闭内置浏览器窗口**: 修复 `PopOutBrowserService` 的 hide-on-close 处理器在退出时阻止窗口销毁导致 Electron 进程无法退出的问题。同步加固 `BrowserAutomationViewService` 的同名处理器，在 `app` 处于退出流程时允许窗口正常关闭（双重保险）。

### 已完成 — 第一阶段核心骨架（2026-05-27）

- **Skill 商店页面（SkillStoreView）**: 商店/已安装双 Tab，市场源选择器，300ms 防抖搜索，分类导航
- **Skill 详情面板**: 右侧滑出详情面板，展示名称/版本/描述/评分/来源/标签，安装/卸载按钮
- **Adapter 架构**: SkillRegistryAdapter 统一接口 + MockSkillRegistryAdapter（12 个 Mock Skill）
- **SkillRegistryService**: 跨市场聚合搜索，安装/卸载，市场源 CRUD，预置 4 个市场源
- **数据库**: migration 008 — skill_registries 表 + skills 表 9 个扩展字段
- **Protocol**: RemoteSkillItem、SkillRegistry 等 11 个新类型 + 11 个新 IPC 通道
- **Bug 修复**: Icons.tsx 新增 Package/ArrowLeft/ExternalLink 图标，安装状态刷新机制

### 进行中 — 第二阶段市场接入（2026-05-27）

- **SkillsMP Adapter（T-04）**: 295 行完整代码已编写（`skillsmp-adapter.ts`），对接 skillsmp.com 公开 API
  - 搜索/推荐/分类/Manifest 获取/健康检查全部实现
  - 支持 API Key 认证（匿名 50 次/天，认证 500 次/天）
  - GitHub URL 智能分类推断 + 关键词标签推断
  - 15s 请求超时 + 429 速率限制处理
  - **待完成**: 接入 `createAdapter` 路由分发，替换 Mock Adapter

### 计划中 — 第二/三阶段（续）

- **市场接入**: SkillsMP、MCP Market、扣子 Coze、Claude Skills 真实 API Adapter
- **Skill 包导入/导出**: 支持 ZIP 格式的 Skill 包导入和导出
- **Skill 管理智能体**: 通过自然语言对话完成 Skill 搜索、安装、删除等操作

**PRD 文档**: `docs/prd/PRD-Skill-Store.md`

---

## [0.1.0] - 2026-05-26

### 初始发布版本 — 本地优先 AI Agent 桌面工作台

#### 核心能力

- **AI 对话**：支持 Anthropic (Claude) 和 OpenAI (GPT-4/o1/o3) 真实流式调用，双模型内核
- **文件操作**：Agent 可读取/写入/列出/搜索工作区文件（带路径穿越保护）
- **权限审批**：完整的工具调用审批流程 — AgentLoop → IPC → PermissionModal → 用户决策 → 执行/拒绝
- **会话管理**：创建/搜索/历史回放/归档/重命名/置顶/删除，支持多轮对话上下文累积
- **工作区管理**：打开项目/文件树浏览/项目类型自动检测（11 种语言）
- **Provider 管理**：CRUD + 健康检查 + API 密钥安全存储（macOS Keychain / Windows Credential Manager）
- **设置管理**：Provider/Model/Rules/Permissions/MCP/Skills 7 个 Tab 完整可用

#### UI 优化第一批 (2026-05-26)

##### Fixed

- **用户消息不显示 Bug**（P0）：修复 `AgentLoop.executeTurn` 未发出 `user_message` 事件的问题。用户发送的消息现在在聊天界面正确显示（头像 "U" + 标签 "你" + 消息内容），包括实时发送和历史消息加载场景。（浩轩-特级开发）

##### Changed

- **会话卡片紧凑化**（P1）：ChatListItem 从三行布局改为 Codex 风格单行紧凑样式。移除消息条数显示，running 状态仅保留小圆点动画指示器，idle 状态无额外徽标。（旭阳-高级开发）
- **输入区域悬浮化**（P1）：Composer 从固定底部分隔线布局改为 Claude Desktop 风格的悬浮卡片。移除 border-top 分隔线，添加 box-shadow 悬浮效果和渐变遮罩。（旭阳-高级开发 + 普通开发-小林）

##### Known Issues

- compact 模式下 `.item-menu-wrap` 未默认隐藏，浪费约 22px 水平空间（P3 低）
- 空状态页面因 `padding-bottom: 180px` 导致垂直偏移（P3 低）
- `padding-bottom: 180px` 硬编码，textarea 自动增高时内容可能被遮挡（P2 中）

#### 技术架构

- **桌面框架**：Electron + TypeScript + React + Vite
- **前端样式**：CSS 变量 Design Tokens 系统（130+ 变量）+ 9 个 ui-kit 组件
- **后端运行时**：AgentLoop + ToolRegistry + AdapterFactory + SessionService
- **数据存储**：SQLite WAL + 10 个数据库表 + 自动迁移
- **IPC 通信**：Typed IPC（zod 校验）+ 15+ IPC 通道 + 流式事件推送
- **测试**：agent-runtime 93 单元测试 + desktop 11 单元测试 + storage 21 单元测试 + E2E smoke test

#### 团队贡献

| 成员 | 贡献 |
|------|------|
| 子涵-架构师 | 项目基础架构、Monorepo 初始化、Protocol 设计 |
| 浩轩-特级开发 | Sidebar 折叠、HomeView 空状态、WorkflowView DAG 精修、ChatView 精修、user_message Bug 修复、代码审查 |
| 旭阳-高级开发 | SQLite Storage、Typed IPC、ChatListItem 紧凑化、Composer 悬浮化 |
| 普通开发-小林 | Design Tokens、ESLint/Vitest/Playwright 配置、HomeView、Settings 页面、Composer 悬浮化优化 |
| codex/claude | Provider/Session/Workspace 全栈、AgentLoop 核心、Adapter 工厂、MCP/Skills/Permission 全栈 |
| Agent产品经理 | 需求分析、PRD 编写、迭代管理、测试协调 |
| Agent测试 | 静态代码分析测试、数据链路验证、验收标准检查 |

#### 已知差距（下一版本规划）

- Agent 无法执行 shell 命令（无 bash/grep/git 工具）
- MCP 服务器配置可管理但无法实际启动和通信
- 规则直接拼入 prompt，无层级合成和冲突检测
- 无 token/成本用量统计
- CommandPalette 为空壳，无命令注册/解析/执行
- Settings 6 个 Tab（General/Shortcuts/Telemetry/Updates/ProfileEditModal）仅为装饰
- Claude Agent SDK 和 Codex SDK 未集成
