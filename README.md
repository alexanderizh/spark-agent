<div align="center">

# SparkWork

**本地优先的桌面 AI Agent 工作台：在一个应用里完成对话、开发、调研、文档、多媒体创作与自动化。**

[官网](https://spark.yiqibyte.com) · [下载](#下载安装) · [功能特性](#功能特性) · [快速开始](#快速开始) · [从源码构建](#从源码构建) · [更新日志](CHANGELOG.md)

[![License](https://img.shields.io/badge/license-Personal%20Use-blue)](#许可证)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)](apps/desktop)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](apps/desktop)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](tsconfig.base.json)
[![pnpm](https://img.shields.io/badge/pnpm-11-F69220?logo=pnpm&logoColor=white)](package.json)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#下载安装)

</div>

## ✨ 项目简介

SparkWork（仓库名 Spark Agent）是一个运行在 macOS、Windows 和 Linux 上的桌面 AI Agent 工作台。它不是单纯的聊天窗口：Agent 的计划与审批、工具调用、终端与代码、浏览器、Git 改动与交付结果全部组织在同一个工作区里——长任务可以持续推进，每一步都能被查看、追问和接管。

- 🧠 **双执行引擎**：同时支持 Claude Agent SDK 与 Codex 执行路径，可按会话切换
- 🏠 **本地优先**：项目、会话、配置和产物默认保存在本机 SQLite 与本地目录
- 🔓 **模型自由**：接入任意 OpenAI 兼容 / Anthropic 协议渠道、本地 CLI 或自定义模型
- 🧩 **可扩展**：自定义工具、自定义应用、MCP、Skills、插件、工作流与团队 Agent

> 项目仍在快速迭代，部分功能和界面可能继续调整。

## 📷 界面预览

![SparkWork 工作台：项目、会话与使用足迹集中在同一界面](apps/website/public/showcase/workbench-home.png)

## 功能特性

### 💬 工作台对话

与 Agent 协作的完整闭环：从输入、排队、审批到追问、分叉、定时唤醒，长任务不丢线索。

- 📎 **富输入**：文件 / 图片 / 目录引用一次最多挂 20 个；支持拖拽投递、粘贴图片、长文本粘贴自动转附件（不撑爆输入框）；每个会话独立保存草稿
- 🗣 **语音输入**：Ctrl+Shift+D 随时口述，实时转写追加到输入草稿
- 🔗 **三种上下文引用**：历史会话作为只读参考挂载、内置浏览器「选取元素」把网页片段变为上下文、代码查看器中选中代码一键插入为引用
- ⌨️ **命令**：内置命令 + 自定义命令（可增删、导入导出），输入 `/` 即达
- 🔄 **消息排队**：Agent 忙碌时继续输入即自动排队；队列支持拖动排序、编辑、单条立即执行与移除；回复异常时自动暂停且不丢消息，可切换模型后重试或跳过继续
- ✏️ **消息级操作**：任意用户消息可重发（原文与附件回填输入区）、从此处分支、回复指定消息或删除
- 💬 **结构化追问与快捷回复**：Agent 可发起单选 / 多选 / 填空的问题向导，支持前进后退与跳过；输入区上方还会给出可一键发送的快捷回复
- 📋 **计划审批**：计划模式下 Agent 先提交计划再动手，可批准、编辑后批准或拒绝，提案历史全程留痕
- 🛡 **分级权限审批**：工具调用内联审批卡，允许一次 / 会话内允许 / 拒绝 / 会话内拒绝四档控制
- 🎯 **目标验收契约**：用验收标准、约束与验证命令锁定目标，Agent 多轮迭代自检，轮次间自动小结并给出终态判定
- 🌿 **会话分叉**：从任意轮次派生新会话，携带已完成历史，与来源互不影响
- ⏰ **会话定时唤醒**：单次 / 固定间隔 / Cron 三种触发，到点自动在本会话继续任务，适合轮询与稍后跟进
- 📜 **历史导入**：并行扫描并导入 Codex、Claude Code、ZCode 的既有本地会话记录
- 🛰 **长任务稳定性**：流式断线自动重连、失败明细与一键重试、Codex 运行时缺失自动引导修复；运行中轮次实时显示耗时
- 🐞 **交互式调试**：疑难 Bug 走「假设 → 临时插桩 → 复现 → 验证 → 清理插桩」的人在回路闭环
- 🎁 **富输出**：Markdown 与代码高亮、HTML 交互沙箱、Mermaid / Markmap 图表（可全屏）、docx / xlsx / pptx / pdf 文档卡片、图片音频视频内联播放、diff 着色、带参数与耗时的工具调用卡片、可折叠思考过程、上下文压缩摘要、Computer Use 操作时间线

### 🖥️ 统一侧边面板

对话右侧是一套可多开、可切换的面板体系——任务的每个侧面都能边看边聊。

- 🖥 **终端**：多标签，支持新建 / 重命名 / 关闭，未读输出红点提示，切换标签不中断进程
- 📝 **代码**：Monaco 编辑器 + 文件树 + 文件搜索 + 全文搜索 + Git diff 视图，选中代码可直接插入为对话引用
- 🌐 **浏览器**：多标签与地址栏、视口尺寸预设、页面元素拾取进会话，可在面板与独立窗口之间切换
- 🔍 **代码审查**：按文件、按 Hunk 查看工作区改动、添加代码或文件到会话
- 📋 **计划**：审批进行中的计划，回看提案历史
- 💬 **侧聊**：不打断主线的辅助小会话，可随时切换或新建
- 🧩 **子应用**：面板型自定义应用自动入驻侧边面板
- 📊 **会话检查器**：随时展开的运行白盒——Token 用量与缓存命中率、TTFT / 中位吞吐 / 生成时间占比与慢轮标记、逐轮 Token 图表、上下文窗口软硬双水位、子 Agent 状态、Worktree 信息、项目上下文预算、两级环境变量与提示词快照

![对话与代码面板并排的 SparkWork 工作区](apps/website/public/showcase/dev-workspace.png)

### 🗂 会话与任务管理

- 📚 **项目分组侧边栏**：项目与会话拖拽排序、置顶、时间筛选与搜索，会话标题由首轮内容自动生成
- ✅ **任务面板**：会话内 TodoList 实时展示完成度与各项状态
- 🗄 **还原点时间线**：自动记录每轮受影响的文件，可展开清单一键还原，还原前自动备份
- 🔔 **通知中心**：任务完成与异常集中提醒
- 🧭 **全局导航**：命令面板、会话搜索、Cmd+B 全局快捷任务（随时丢一个任务给 Agent 立即执行），快捷键均可在设置中改键
- 🔥 **用量热力图**：空会话首页直观回顾使用节奏

### 💻 开发与自动化

- 🌳 **独立工作区（Worktree）**：会话在单独分支目录中执行，多任务互不干扰
- 🖱️ **Computer Use**：按单次任务治理地操作本机应用，支持查看状态、接管与停止
- 🔧 **环境变量**：项目级与会话级配置，支持 JSON 一键导入导出

![SparkWork 代码开发与 Git 审查面板](apps/website/public/showcase/code-review.png)

### 🤖 Agent、工作流与团队

- 👤 **自定义 Agent**：为不同角色配置模型、提示词、权限、Skills、Rules、Hooks 和工具
- 🔀 **可视化工作流**：通过节点和连线编排输入、计划、Agent、工具、审批、验证与交付
- 👥 **团队 Agent**：Host 调度多个成员 Agent 分工执行，成员间可互相通信协作
- 🧠 **长期记忆**：按用户、项目和 Agent 三层隔离，混合语义与全文检索按需召回
- 📚 **提示词库**：集中管理可复用提示词
- 🗂 **看板任务面板**：待办、执行中、修复、完成与验收状态集中管理
- ⏱ **全局定时任务**：跨会话的计划任务调度

![SparkWork 可视化工作流编排](apps/website/public/showcase/workflow-orchestration.png)

### 🎨 无限画布与多媒体创作

- 🖼 **无限画布**：缩放平移的画布上组织文本、图片、视频、音频与分组节点，保留来源关系
- 🤖 **画布 Agent**：读取当前选择与项目结构，创建、连接、整理节点并继续执行工作流
- 🎬 **多媒体生成**：文生图、图生图、图片编辑与合成、文生视频、图生视频、视频编辑、配音与语音转写
- 🗃 **资产中心**：管理角色、场景、道具、分镜与生成结果，适合持续迭代的内容项目
- 🎞 **影视工具链**：分镜、关键帧、视频工作台、3D 导演台与 360° 全景
- 📄 **文档与演示生成**：课件、调研报告、数据分析报告，输出 HTML / PPTX / DOCX / Markdown

![SparkWork 无限画布与画布 Agent](apps/website/public/showcase/infinite-canvas.png)

### 🧩 扩展生态与模型接入

- 🔧 **自定义工具**：把 API、脚本或业务能力封装成 Agent 可自主调用的工具；支持从空白、cURL、模板导入，定义输入 Schema，草稿与发布版本隔离，可测试、发布、启停与回滚，密钥进入加密凭据库
- 📦 **Tool Package**：多文件工具包统一管理运行环境、配置、权限与版本
- 🧩 **自定义应用（子应用）**：在对话中让 Agent 开发小应用，代码与数据独立保存，支持发布、回滚与归档，可运行在内容区、侧边面板、浮层、独立窗口或桌面宠物
- 🔌 **MCP 服务器**：管理 Model Context Protocol 服务器与工具导入
- 🧠 **Skills 技能体系**：内置技能库、在线技能市场与 GitHub 一键安装
- 🔌 **插件系统**：安装平台插件扩展 Agent 能力
- 🐙 **GitHub 连接器**：在会话中直接操作仓库、Pull Request 与 Issue
- 📡 **远程连接**：将 Telegram、飞书、QQ、微信消息桥接进会话，在外部聊天中驱动 Agent
- 🌍 **内置联网搜索**：多搜索引擎联网检索与网页阅读
- ☁️ **多 Provider 管理**：OpenAI 兼容 / Anthropic 协议、自定义渠道与多媒体模型渠道统一管理

![SparkWork 模型渠道管理](apps/website/public/showcase/providers.png)

### 🔒 本地优先与安全

- 🗄 结构化数据保存在本地 SQLite，项目文件与生成产物留在本地工作区
- 🔐 敏感凭据通过系统凭据能力与加密凭据库管理，不写入普通项目配置
- 🛡 文件、命令、网络、桌面操作和外部工具受权限模式与工具策略控制
- 🎨 深浅色主题、多窗口（画布 / 浏览器独立窗口）等桌面级体验

## 下载安装

在 [GitHub Releases](https://github.com/alexanderizh/spark-agent/releases) 获取最新安装包：

| 平台    | 格式                 |
| ------- | -------------------- |
| macOS   | `.dmg`               |
| Windows | `.exe` / NSIS 安装包 |
| Linux   | `.AppImage` / `.deb` |

## 快速开始

1. 安装应用，配置一种 Provider（OpenAI 兼容 / Anthropic 协议），或启用本地 Claude / Codex CLI
2. 新建临时会话，或打开一个本地项目
3. 描述目标，按需附加文件、目录、图片或引用其他会话；Agent 提交计划后确认执行
4. 在对话右侧打开终端、代码、浏览器或审查面板边看边聊，继续追问、调整消息队列或从还原点回退

## 从源码构建

### 环境要求

- Node.js `>=22.14.0 <23`
- pnpm `>=11.13.0 <12`
- Git

Windows 从源码安装时建议准备 Visual Studio Build Tools，以便构建 `better-sqlite3`、`keytar` 等原生依赖。

```bash
git clone https://github.com/alexanderizh/spark-agent.git
cd spark-agent
pnpm install
pnpm dev
```

常用检查与打包：

```bash
pnpm typecheck   # 类型检查
pnpm lint        # 代码检查
pnpm test        # 单元测试
pnpm build       # 构建

pnpm --filter @spark/desktop build:mac    # macOS 打包
pnpm --filter @spark/desktop build:win    # Windows 打包
pnpm --filter @spark/desktop build:linux  # Linux 打包
```

## 📦 项目结构

```text
spark-agent/
├── apps/
│   ├── desktop/        # Electron 桌面应用（主进程 + React 渲染端）
│   └── website/        # 官网与截图素材
├── packages/
│   ├── agent-runtime/  # 会话运行时与服务编排
│   ├── protocol/       # 跨进程 IPC 协议与类型
│   ├── storage/        # SQLite 存储层
│   ├── shared/         # 跨进程共享工具
│   ├── ui-kit/         # 共享 UI 组件
│   └── plugin-sdk/     # 插件 SDK
└── spark-engine/       # 终端交互子项目
```

主要技术栈：Electron 43 · React 19 · TypeScript · Tailwind CSS · Ant Design · XYFlow · Claude Agent SDK · Codex · MCP · SQLite · pnpm workspace · Vitest · Playwright

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request。提交前建议运行：

```bash
pnpm typecheck && pnpm lint && pnpm test
```

如果发现安全问题，请不要在公开 Issue 中披露敏感细节，请先通过仓库维护者提供的私有联系方式沟通。

## 🧑‍💻 贡献者

感谢每一位为 SparkWork 贡献代码的人：

<a href="https://github.com/fizzlx001" title="fizzlx001">
  <img src="https://github.com/fizzlx001.png" width="96" height="96" alt="fizzlx001" />
</a>

## ⭐ Star History

<a href="https://star-history.dera.page/#alexanderizh/spark-agent&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=alexanderizh/spark-agent&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=alexanderizh/spark-agent&type=Date" />
    <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=alexanderizh/spark-agent&type=Date" />
  </picture>
</a>

## 许可证

本项目使用基于 Apache License 2.0、附加个人用途限制的许可证，详情见 [LICENSE](LICENSE)。个人学习、研究、评估与非商业自用可以使用；公司/机构内部使用、客户交付、付费服务或其他商业用途需要事先获得书面授权。

该许可证不是标准 SPDX `Apache-2.0` 许可证。

---

<div align="center">
<sub>Built with Electron · React · TypeScript · pnpm.</sub>
</div>
