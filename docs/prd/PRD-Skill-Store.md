# PRD: Skill 商店（Skill Store）

> 版本: 1.0  
> 日期: 2026-05-27  
> 产品经理: Agent产品经理  
> 开发负责人: 浩轩-特级开发  
> 状态: 待开发

---

## 1. 背景与目标

### 1.1 背景

当前 Spark Agent 的 Skills 模块已实现本地 CRUD 管理（SkillService + IPC + SkillsView），但用户只能使用内置的 3 个 Skill（Web搜索、计算器、代码执行），无法发现和安装更多能力。

2025 年底 Anthropic 发布 Agent Skills 开放规范，国内扣子（Coze）、阿里云工具市场等平台已推出产品化 Skills 商店，MCP Market、SkillsMP 等国际市场也已成熟。Skill 商店是 Agent 产品差异化竞争的关键能力。

### 1.2 目标

1. **接入多个 Skill 市场**，让用户可以从主流平台搜索、发现、安装 Skill
2. **完善本地 Skill 管理**，支持本地检索、外部包导入导出
3. **提供 Skill 管理智能体**，通过自然语言对话完成 Skill 的搜索、安装、删除等操作
4. **本期不涉及 Skill 在 Agent 运行时的实际执行**，等市场完善后再做执行集成

### 1.3 不做的事

- ❌ Skill 在 AgentLoop 中的实际执行引擎（后续版本）
- ❌ Skill 开发者发布流程（后续版本）
- ❌ Skill 付费/交易流程（后续版本）
- ❌ 自建 Skill 市场后端服务（本期只做客户端聚合）

---

## 2. 用户故事

### 核心用户故事

| # | 作为... | 我想要... | 以便... | 优先级 |
|---|---------|-----------|---------|--------|
| US-01 | Agent 用户 | 浏览多个 Skill 市场的热门/推荐 Skill | 发现有用的能力扩展 | P0 |
| US-02 | Agent 用户 | 通过关键词在所有市场中搜索 Skill | 快速找到我需要的能力 | P0 |
| US-03 | Agent 用户 | 一键安装市场 Skill 到本地 | 扩展 Agent 能力 | P0 |
| US-04 | Agent 用户 | 查看已安装的 Skill 列表并管理（启用/禁用/删除） | 保持本地 Skill 整洁 | P0 |
| US-05 | Agent 用户 | 从本地文件夹导入 Skill 包 | 使用自定义或团队共享的 Skill | P1 |
| US-06 | Agent 用户 | 导出本地 Skill 为包文件 | 与团队共享或备份 | P1 |
| US-07 | Agent 用户 | 通过对话让智能体帮我搜索和安装 Skill | 用自然语言完成 Skill 管理 | P1 |
| US-08 | Agent 用户 | 查看 Skill 的详细信息（描述、版本、来源、评分） | 评估是否安装 | P1 |

---

## 3. 功能模块设计

### 3.1 模块总览

```
Skill 商店页面（SkillStoreView）
├── 市场浏览 Tab
│   ├── 市场选择器（多个市场源切换）
│   ├── 分类导航（热门/最新/分类浏览）
│   ├── Skill 卡片网格
│   └── 搜索栏（跨市场搜索）
├── 已安装 Tab（现有 SkillsView 增强）
│   ├── 本地 Skill 列表
│   ├── 启用/禁用切换
│   ├── 删除/导出操作
│   └── 本地文件导入
├── Skill 详情面板（侧边滑出）
│   ├── 基本信息（名称、版本、描述、作者）
│   ├── 来源信息（市场名称、链接）
│   ├── 安装/卸载按钮
│   └── Manifest 预览
└── Skill 管理智能体（对话式）
    ├── 自然语言搜索
    ├── 推荐安装
    ├── 批量管理
    └── 通过 Skill 完成 Skill CRUD
```

### 3.2 Skill 市场数据源

本期接入的市场源（通过 Registry Adapter 模式接入，每个市场实现统一接口）：

| 市场源 | 类型 | 接入方式 | 说明 |
|--------|------|----------|------|
| **SkillsMP** | 国际 | HTTPS API | Agent Skills 聚合市场，支持 Claude/Codex/ChatGPT Skills |
| **MCP Market** | 国际 | HTTPS API | MCP Server 发现平台，含 AI Skill Store |
| **扣子 Coze** | 国内 | HTTPS API | 字节跳动旗下，国内最大的 AI Skill 商店 |
| **Claude Skills** | 国际 | HTTPS API | Anthropic 官方 Skills 规范 |
| **本地目录** | 本地 | 文件系统扫描 | 用户本地文件夹中的 Skill 包 |

> **设计原则**: 市场源通过统一的 `SkillRegistryAdapter` 接口接入。每个市场是一个 Adapter 实现，返回标准化的 `RemoteSkillItem` 数据。新增市场只需新增 Adapter，不改核心逻辑。

### 3.3 Skill 数据模型扩展

#### 3.3.1 远程 Skill 条目（新增）

```typescript
interface RemoteSkillItem {
  id: string                    // 市场 ID（带前缀，如 "skillsmp:xxx"）
  name: string                  // Skill 名称
  description: string           // 详细描述
  version: string               // 版本号
  author: string                // 作者/组织
  registryId: string            // 来源市场 ID
  registryName: string          // 来源市场名称
  category: string              // 分类标签
  tags: string[]                // 搜索标签
  rating: number                // 评分 (0-5)
  downloadCount: number         // 下载量
  homepageUrl?: string          // 主页链接
  manifestUrl: string           // Manifest 文件 URL
  iconUrl?: string              // 图标 URL
  installed: boolean            // 是否已安装到本地
  localId?: string              // 安装后的本地 ID
}
```

#### 3.3.2 Skill 市场源配置（新增）

```typescript
interface SkillRegistry {
  id: string                    // 市场 ID
  name: string                  // 市场名称
  description: string           // 市场描述
  iconUrl?: string              // 市场 Logo
  apiBaseUrl: string            // API 基础 URL
  enabled: boolean              // 是否启用
  type: 'remote' | 'local'      // 远程市场 / 本地目录
  localPath?: string            // 本地目录路径（type=local 时）
  lastSyncAt?: string           // 上次同步时间
}
```

#### 3.3.3 数据库表新增

```sql
-- Skill 市场源配置表
CREATE TABLE skill_registries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_url TEXT,
  api_base_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  type TEXT NOT NULL DEFAULT 'remote',
  local_path TEXT,
  last_sync_at TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Skills 表增加字段
ALTER TABLE skills ADD COLUMN registry_id TEXT;
ALTER TABLE skills ADD COLUMN remote_id TEXT;
ALTER TABLE skills ADD COLUMN author TEXT DEFAULT '';
ALTER TABLE skills ADD COLUMN category TEXT DEFAULT '';
ALTER TABLE skills ADD COLUMN tags_json TEXT DEFAULT '[]';
ALTER TABLE skills ADD COLUMN rating REAL DEFAULT 0;
ALTER TABLE skills ADD COLUMN download_count INTEGER DEFAULT 0;
ALTER TABLE skills ADD COLUMN homepage_url TEXT;
ALTER TABLE skills ADD COLUMN icon_url TEXT;
```

### 3.4 IPC 通道新增

| 通道 | 请求 | 响应 | 说明 |
|------|------|------|------|
| `skill-registry:list` | `{}` | `{ registries: SkillRegistry[] }` | 列出所有市场源 |
| `skill-registry:update` | `{ id, enabled?, configJson? }` | `{ registry: SkillRegistry }` | 更新市场源配置 |
| `skill-registry:search` | `{ query, registryId?, category?, limit?, offset? }` | `{ skills: RemoteSkillItem[], total: number }` | 跨市场搜索 |
| `skill-registry:featured` | `{ registryId, limit? }` | `{ skills: RemoteSkillItem[] }` | 获取热门/推荐 |
| `skill-registry:install` | `{ remoteSkillId, registryId }` | `{ skill: SkillItem }` | 从市场安装到本地 |
| `skill-registry:uninstall` | `{ localSkillId }` | `{ success: boolean }` | 卸载（等同 skill:delete） |
| `skill-registry:categories` | `{ registryId }` | `{ categories: string[] }` | 获取市场分类列表 |
| `skill:import-file` | `{ filePath }` | `{ skill: SkillItem }` | 从本地文件导入 |
| `skill:import-directory` | `{ directoryPath }` | `{ skills: SkillItem[], failed: number }` | 从目录批量导入 |
| `skill:export` | `{ skillId, targetPath }` | `{ filePath: string }` | 导出 Skill 包 |
| `skill:export-batch` | `{ skillIds, targetPath }` | `{ filePath: string, count: number }` | 批量导出 |

### 3.5 UI 页面设计

#### 3.5.1 Skill 商店页面布局

页面采用 **Tab 切换** 模式，两个主 Tab：

**Tab 1: 商店（Store）**

```
┌─────────────────────────────────────────────────────────┐
│  Skill 商店                                  [搜索栏...] │
├─────────┬───────────────────────────────────────────────┤
│ 市场源   │  分类: [全部] [热门] [最新] [代码] [文档] [分析] │
│ ─────── │ ───────────────────────────────────────────── │
│ ● 全部   │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐        │
│ SkillsMP │  │Card 1│ │Card 2│ │Card 3│ │Card 4│        │
│ MCP Mkt  │  │      │ │      │ │      │ │      │        │
│ 扣子     │  │[安装] │ │[安装] │ │已安装 │ │[安装] │        │
│ Claude   │  └──────┘ └──────┘ └──────┘ └──────┘        │
│ ─────── │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐        │
│ 本地目录 │  │Card 5│ │Card 6│ │Card 7│ │Card 8│        │
│ + 添加   │  │      │ │      │ │      │ │      │        │
│          │  │[安装] │ │[安装] │ │[安装] │ │[安装] │        │
│          │  └──────┘ └──────┘ └──────┘ └──────┘        │
│          │                                               │
│          │           [加载更多...]                        │
├─────────┴───────────────────────────────────────────────┤
│  统计: 3 个市场源 · 1,234 个可用 · 5 个已安装              │
└─────────────────────────────────────────────────────────┘
```

**Tab 2: 已安装（Installed）**

沿用现有 SkillsView 的卡片网格布局，增强操作按钮：
- 每张卡片增加「导出」和「详情」按钮
- 增加顶部「导入」按钮（支持文件导入和目录导入）
- 增加批量选择模式（勾选多个后批量导出/删除）

#### 3.5.2 Skill 详情面板（侧边滑出）

点击任意 Skill 卡片，从右侧滑出详情面板：

```
┌──────────────────────────┐
│  [← 返回]  Skill 详情     │
│                          │
│  ┌────┐                  │
│  │图标│  Skill 名称       │
│  └────┘  v1.2.0          │
│          作者名            │
│                          │
│  ┌──────────────────┐    │
│  │ ★★★★☆  4.5分     │    │
│  │ 下载量: 1,234     │    │
│  │ 来源: SkillsMP    │    │
│  └──────────────────┘    │
│                          │
│  描述                     │
│  这是一段详细的 Skill      │
│  功能描述文字...           │
│                          │
│  标签: [代码] [生成] [AI]  │
│                          │
│  Manifest 预览            │
│  ┌──────────────────┐    │
│  │ { name: "...",   │    │
│  │   version: "..." │    │
│  │   tools: [...] } │    │
│  └──────────────────┘    │
│                          │
│  [安装到本地]  [访问主页]   │
└──────────────────────────┘
```

#### 3.5.3 Skill 管理智能体

在 Skill 商店页面底部或右下角提供「Skill 助手」浮动按钮，点击后弹出对话面板：

**触发方式**: 点击右下角浮动按钮，或在 Composer 中使用 `/skill` 命令

**能力范围**:
- 搜索: "帮我找一个能生成测试用例的 Skill"
- 推荐: "推荐几个代码审查相关的 Skill"
- 安装: "安装刚才搜到的第一个 Skill"
- 管理: "把未使用的 Skill 都禁用"
- 导入: "帮我导入 D:/skills 目录下的所有 Skill"

**实现方式**: Skill 管理智能体通过现有的 `session:send-turn` IPC 发送消息，在 system prompt 中注入 Skill 商店 API 的工具定义。智能体可以调用 `skill-registry:search`、`skill-registry:install`、`skill:list`、`skill:update`、`skill:delete` 等 IPC 作为工具。

### 3.6 Skill 包格式

本地导入/导出的 Skill 包格式（ZIP）：

```
skill-package.zip
├── manifest.json        # Skill 元数据
├── README.md            # 使用说明
├── skill.md             # Skill 指令文件（SKILL.md）
└── assets/              # 可选资源文件
    └── templates/
```

**manifest.json 格式**:

```json
{
  "name": "skill-name",
  "version": "1.0.0",
  "description": "Skill 功能描述",
  "author": "作者名",
  "source": "自定义",
  "category": "代码",
  "tags": ["code", "review"],
  "icon": "assets/icon.png",
  "homepage": "https://...",
  "entryPoint": "skill.md"
}
```

---

## 4. 任务拆解

### 4.1 开发任务清单

| # | 任务 | 涉及文件 | 优先级 | 预估复杂度 |
|---|------|----------|--------|-----------|
| T-01 | 数据库迁移：新增 skill_registries 表 + skills 表字段扩展 | migration SQL | P0 | 低 |
| T-02 | Protocol 类型定义：RemoteSkillItem、SkillRegistry、新增 IPC 通道 | protocol/ipc + protocol/schemas | P0 | 低 |
| T-03 | SkillRegistryService：市场源管理 + Adapter 接口定义 | agent-runtime/services | P0 | 中 |
| T-04 | SkillsMP Adapter：接入 SkillsMP 市场 | agent-runtime/adapters | P0 | 中 |
| T-05 | MCP Market Adapter：接入 MCP Market | agent-runtime/adapters | P1 | 中 |
| T-06 | 扣子 Coze Adapter：接入扣子技能商店 | agent-runtime/adapters | P1 | 中 |
| T-07 | Claude Skills Adapter：接入 Anthropic Skills | P1 | 中 |
| T-08 | IPC Handler 注册：注册所有新增 IPC 通道 | desktop/main/ipc | P0 | 低 |
| T-09 | SkillStoreView 页面：商店 Tab UI + 搜索 + 卡片网格 | renderer/design/views | P0 | 高 |
| T-10 | Skill 详情面板：侧边滑出详情 + 安装/卸载 | renderer/design/views | P0 | 中 |
| T-11 | 已安装 Tab 增强：导入/导出/批量操作 | SkillsView.tsx 增强 | P1 | 中 |
| T-12 | Skill 包导入/导出：文件选择 + ZIP 解析/生成 | agent-runtime/services | P1 | 中 |
| T-13 | Skill 管理智能体 system prompt + 工具注入 | agent-runtime | P2 | 中 |
| T-14 | Skill 管理智能体对话面板 UI | renderer/design/views | P2 | 中 |

### 4.2 建议开发顺序

**第一阶段（核心骨架）**: T-01 → T-02 → T-03 → T-08 → T-09 → T-10
**第二阶段（市场接入）**: T-04 → T-05 → T-06 → T-07
**第三阶段（增强功能）**: T-11 → T-12 → T-13 → T-14

---

## 5. 验收标准

### 5.1 核心功能验收

| # | 验收标准 | 优先级 |
|---|----------|--------|
| AC-01 | 用户可以在商店页面看到多个市场源的 Skill 列表 | P0 |
| AC-02 | 用户可以通过关键词在市场中搜索 Skill，搜索结果实时展示 | P0 |
| AC-03 | 用户可以点击「安装」将市场 Skill 安装到本地，安装后出现在「已安装」Tab | P0 |
| AC-04 | 用户可以在「已安装」Tab 查看、启用/禁用、删除本地 Skill | P0 |
| AC-05 | 点击 Skill 卡片可弹出详情面板，展示名称/版本/描述/评分/来源等信息 | P0 |
| AC-06 | 市场源可通过左侧栏切换，支持「全部」聚合视图 | P1 |
| AC-07 | 用户可以从本地 ZIP 文件导入 Skill 包 | P1 |
| AC-08 | 用户可以将本地 Skill 导出为 ZIP 包 | P1 |
| AC-09 | 用户可以从本地目录批量导入 Skill | P1 |
| AC-10 | Skill 管理智能体可通过对话完成搜索、安装、删除等操作 | P2 |

### 5.2 UI/UX 验收标准

| # | 验收标准 | 说明 |
|---|----------|------|
| UX-01 | 商店页面整体风格与现有 SkillsView 保持一致 | 使用相同的 Design Tokens、卡片风格、间距 |
| UX-02 | Skill 卡片设计统一，不论来源市场 | 所有市场的 Skill 使用同一套卡片组件 |
| UX-03 | 搜索响应流畅，输入有防抖处理 | 300ms debounce |
| UX-04 | 安装/卸载操作有明确的 loading 和成功/失败反馈 | 使用 Toast 通知 |
| UX-05 | 网络请求失败有友好的错误提示和重试机制 | 网络异常、市场不可用等场景 |
| UX-06 | 空状态设计完整 | 无搜索结果、市场源不可用、未安装任何 Skill |
| UX-07 | 详情面板滑出动画流畅 | 300ms transition |
| UX-08 | 大量 Skill 时卡片网格滚动流畅 | 懒加载或虚拟列表 |

---

## 6. 风险与约束

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| 第三方市场 API 不稳定或无公开 API | 无法获取 Skill 列表 | 先实现 Adapter 接口 + Mock 数据，API 调研后再接入真实数据 |
| 恶意 Skill 安全风险 | 用户安装恶意 Skill | 安装前展示 Manifest 预览，标记「未验证」状态 |
| 市场数据格式不统一 | 每个 Adapter 需要单独适配 | 统一 `RemoteSkillItem` 接口做映射层 |
| 网络请求阻塞 UI | 搜索/加载时界面卡顿 | 异步请求 + loading 状态 + 缓存 |
| Skills 表结构变更 | 需要数据库迁移 | 兼容旧数据，新字段设默认值 |

---

## 7. 测试要点

| 测试场景 | 验证内容 |
|----------|----------|
| 搜索功能 | 关键词搜索返回结果、空搜索返回全部、中文/英文搜索 |
| 安装流程 | 安装成功 Toast、安装后列表更新、重复安装提示 |
| 卸载流程 | 确认弹窗、卸载成功 Toast、列表更新 |
| 市场切换 | 切换市场源后列表更新、全部聚合视图 |
| 网络异常 | 请求超时/失败时错误提示、重试按钮 |
| 导入导出 | ZIP 文件正确解析、导出文件可再次导入 |
| 详情面板 | 信息展示完整、安装/卸载按钮状态正确 |
| 空状态 | 各场景空状态文案和图标正确 |
