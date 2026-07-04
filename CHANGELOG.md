# Spark Agent Changelog

所有重要变更均记录在此文件中。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

---

## [Unreleased] - Skill 商店开发中

### 新功能 — 团队模式 A2A 深度协作升级（2026-07-04）

- **codex 团队协作可用**：团队工具改为支持 codex 侧可见的桥接注入路径，codex Host / Member 可参与团队调度，不再被 in-process MCP server 卡死。
- **共享讨论线程**：团队讨论新增持久化 thread / round 状态，成员被再次派发时会看到 `[Discussion So Far]`，并按 discussion scope 复用安全可续的 SDK session。
- **peer messaging**：新增 `agent_message`，支持广播异步留言与定向 `@` 单次触发；事件流新增成员间消息、轮次推进、讨论收尾三类时间线块。
- **显式轮次控制**：新增 `team_round_advance` / `team_conclude`，前端支持轮次分割线与讨论状态卡片，团队讨论不再依赖 prompt 里的“自己收敛”暗规则。
- **团队配置扩展**：长期团队定义、IPC 协议、Inspector/TeamsPanel 已支持 `maxDiscussionRounds` 与实验性 `enablePeerMessaging`。
- **安全兜底收口**：成员 prompt 只描述真实可用的 peer messaging 能力；后端新增 self-`@` / 同轮 A↔B 即时互 `@` 拦截，并把 discussion 消息上限改为基于持久化线程计数的硬限制。
- **成员自由交流 v2**：成员 prompt 新增四模式协作手册；`agent_message` 支持 `mode: 'call' | 'note'`，定向 note 只写共享线程并在目标成员 prompt 标注 `[NOTE FOR YOU]`；同步咨询新增 deadline 传递、3 层深度上限和独立 peer call 预算；成员间气泡显示发送方、接收方与留言标识。

### UI 统一 — 全量下拉弹窗迁移到 Arco Design（2026-06-05）

- **`SparkSelect` 重写**：去掉 `bordered={false}` + 重画外观的做法，改为直接复用 Arco `Select` 自带的下拉弹窗，CSS 只做轻量主题贴合（颜色/圆角/边框/箭头），视觉与 Arco 默认一致。
- **修复无效选择器**：`styles.css` 中 `.arco-select-view-icon` 实际在 Arco v2.66 已重命名为 `.arco-select-arrow-icon`，旧规则 0 命中；改用真实类名覆盖箭头 / 后缀图标。
- **清理原生 `<select>`**：`TeamInspectorSection.tsx` 「最大深度」原本是裸 `<select>`，已替换为 `SparkSelect`；同步更新 `views.css` 里的 `.team-roster-advanced-row select` 规则以适配新结构。
- **规则写入**：`AGENTS.md` 新增「Arco Design 优先」强制规则，明确禁止原生 `<select>`、自写 popup、自写表单拼接；所有下拉必须走 `SparkSelect`。

### 新功能 — 团队模式（Team Agent Mode / A2A，2026-06-05）

- **团队模式**: 底部 Agent 选择器新增「团队模式」，主持 Agent(Host) 可在对话中通过 `agent_team_dispatch` 工具动态调用被授权的成员 Agent(Member)，以类 IM 群聊形式展示多 Agent 协作。仅在显式启用时进入新分支，旧 Session 行为零回归。
- **A2A 运行时**: 新增 `TeamDispatchService` 与同进程 `spark_team` MCP server；成员以自身 provider/model/skills/MCP 运行 one-shot turn，流式输出 rebrand 为 `team_member_message`；支持成员级 MCP 工具、嵌套调用（`allowNesting` + `maxDepth`，最大 3）、单 turn dispatch 预算（5）、超时（默认 120s）与取消传播。
- **群聊式 UI**: ChatView 时间线新增 `TeamDispatchCard`（调用卡片）与 `TeamMemberBubble`（缩进 + 成员配色气泡）；Inspector 新增「团队成员」区块（成员勾选/邀请/嵌套设置/成员详情展开）；点击成员头像滑出 `TeamMemberDrawer` 详情抽屉。
- **协议与存储**: 新增 4 个团队事件、`TeamModeConfig`/`TeamMemberCard`/`TeamA2ATask`/`TeamA2AReply` 类型、`team:update`/`team:list-members`/`team:list-dispatches` 三个 IPC 通道；migration 016 新增 `team_dispatches` 表；会话级配置写入 `sessions.metadata.team`。
- **测试**: `TeamDispatchService` 边界（6）、`buildTeamRosterPrompt`（2）、event-mapper 团队事件归约（4）单元测试。

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
