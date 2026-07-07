# 内置「安装卡片」技能（Installable Skill Catalog）

> 状态: 实施中 | 最后核对: 2026-07-07

## 背景：为什么不直接内置完整技能

部分技能（如 `ppt-master` ~96MB、上万文件）体积大，直接随包内置会显著膨胀安装包；另一些技能（如
`playwright` 终端 CLI 技能）虽不大，但并非所有用户都需要。为此，应用采用「**内置安装卡片 + 一键按需
安装完整原装技能**」的方式：

- 应用只内置技能的**元信息卡片**（名字、描述、来源），新机器装完即可在「技能 → 精选技能」看到；
- 用户点击「安装」时，优先从 Spark 自建安装源下载**完整原装技能**（不裁剪、不精简），自建源不可用时才走兜底源；
- 安装后技能落到用户技能目录（`{userData}/skills/`），与本地导入的技能同等可用、可启用、可挂到会话。
- 安装进度由主进程通过 `stream:skill:install-progress` 推送，技能市场页面的 Tab 切换或列表刷新不会丢失当前安装进度展示；安装完成后重新读取目录和数据库状态，避免出现“实际已安装但精选市场仍显示未安装”的状态漂移。

> 与「内置技能」(`apps/desktop/resources/skills/`，随包分发、只读) 的区别：
> 内置卡片只装**来源信息**，真正内容按需从远端拉取。已经随安装包内置的技能不要重复打包进 MinIO；自建源只维护非内置技能、运行时安装包和离线依赖包。

## 数据流

```
┌────────────────────┐  skill:list-installable   ┌──────────────────────────┐
│  SkillStoreView    │ ◀─────────────────────── │ SkillRegistryService     │
│  「精选技能」Tab    │                          │  .listInstallableCatalog()│
│  (renderer)        │                          │   ↑ 读 INSTALLABLE_SKILL │
│                    │  skill:install-catalog    │     _CATALOG 常量 + 查库  │
│  卡片 [安装] 按钮   │ ───────────────────────▶ │  .installFromCatalog()   │
│                    │                          │   ├ type=artifact → MinIO │
│  进度条            │ ◀ stream:skill:           │   │   manifest + zip      │
│  (stream 推送)     │   install-progress        │   ├ type=tarball → tarball│
│  页面重新进入       │ ◀ skill:install-status    │   │   -installer         │
│  恢复后台进度       │                          │   └ type=github  → 既有  │
│                    │                          │       installFromGithub   │
└────────────────────┘                          │                          │
                                                └────────────┬─────────────┘
                                                              │ 写入 {userData}/skills/<slug>
                                                              ▼
                                                ┌──────────────────────────┐
                                                │ skills 表（skill:catalog:*）│
                                                └──────────────────────────┘
```

## 三种安装路径

| source.type | 适用                                        | 实现                                                                                                                                                                             | 限制                                                                                                        |
| ----------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `artifact`  | 国内/企业内网优先的大技能（如 ppt-master）  | 读取 `https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/index.json` → 按 artifact id 找 zip → 下载 → SHA256 校验 → 解压 → 整目录复制到 `{userData}/skills/<slug>/` | 需要维护 MinIO 对象与 manifest；若自建源不可用，可配置 `fallback` 回到 `tarball` / `github`                 |
| `tarball`   | 大体量技能（ppt-master 上万文件 / 近百 MB） | 下载 `codeload.github.com/<repo>/tar.gz/refs/heads/<ref>` → 解压 → 取 `path` 子目录 → 整目录复制到 `{userData}/skills/<slug>/`                                                   | 解包优先用系统 `tar`，不可用时回落纯 JS（POSIX ustar 解析）。突破 GitHub Contents API 的 60 文件 / 1MB 限制 |
| `github`    | 小技能（≤60 文件、单文件 ≤1MB）             | 复用既有 `installFromGithub()`：逐文件下载、落盘、建库                                                                                                                           | 受 GitHub Contents API 限速与文件上限约束                                                                   |

> 当前 `ppt-master`、`superpowers-*`、`gitnexus-*` 和 AI 影视制作类推荐技能均优先走 `artifact`；`ppt-master` / `playwright` 保留 GitHub tarball 兜底。

## 国内网络与镜像

- SkillHub 推荐市场走 `https://api.skillhub.cn`，安装时使用 `/api/v1/download?slug=` 的 zip 整包下载，后端 302 到腾讯云 COS 加速域名，是当前国内用户的首选路径。
- 内置精选技能优先走 Spark 自建安装源：`https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/index.json`。本仓库提供同路径的本地目录 `minio/spark-desktop/artifact-repository/v1/`，其中包含 manifest、非内置推荐技能 zip、Node.js 22 包、Python 3.11 包，以及 `ppt-master` 的 macOS arm64 / Windows x64 / Linux x64 Python 3.11 wheelhouse，上传到 MinIO 后即可被应用读取。
- 系统内置提示词要求：安装依赖库、运行时环境或系统安装包时，优先级必须是 **Spark 自建安装源 → 国内镜像源 → 外网源**。当任务缺少环境时，agent 应先帮助用户补齐环境：说明安装计划并在需要联网、写入系统目录或安装大包时征得同意，然后自动安装并验证；不要把绕过缺失环境当作首选方案。安装 Node.js 前，agent 还应先检查 `SPARK_ELECTRON_NODE` + `ELECTRON_RUN_AS_NODE=1` 暴露的应用内置 Electron Node 是否能满足 Node 脚本/MCP 子进程需求；只有需要普通 shell `node/npm/npx` 或内置运行时不足时才安装系统/portable Node.js。
- 内置精选卡片的 `tarball` 路径先尝试 GitHub `codeload.github.com`，失败后会依次尝试 `https://gh-proxy.com/<原始URL>`、`https://ghproxy.net/<原始URL>` 这类镜像前缀代理。
- 当前清单里的 GitHub 兜底源均显式配置 `ref: main`，不会额外请求 GitHub API 解析默认分支。
- 仍需注意：旧的 `github` 逐文件安装路径依赖 GitHub Contents API 和 raw download；未来如果新增 `tarball` 卡片但不写 `ref`，默认分支探测也会访问 GitHub API。若要让无海外网络的用户稳定安装，优先把精选技能接入 SkillHub zip 分发，或为 GitHub API/raw 下载也增加可配置镜像网关。

## 关键文件

| 文件                                                                        | 作用                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/agent-runtime/src/services/skill-registry/installable-catalog.ts` | 内置可安装技能**清单常量** `INSTALLABLE_SKILL_CATALOG` + 类型。新增技能只改这里                                                                                                            |
| `packages/agent-runtime/src/services/skill-registry/artifact-manifest.ts`   | Spark 自建安装源 manifest 拉取、校验与 artifact URL 解析                                                                                                                                   |
| `packages/agent-runtime/src/services/skill-registry/tarball-installer.ts`   | tarball 下载 / 解压 / 取子目录 / 落盘（突破文件数上限）                                                                                                                                    |
| `packages/agent-runtime/src/services/skill-registry/index.ts`               | `SkillRegistryService` 暴露 `listInstallableCatalog()` / `installFromCatalog()` / `uninstallFromCatalog()`；artifact/tarball 路径落盘后建/更新库记录（id `skill:catalog:<指纹>`）          |
| `packages/protocol/src/ipc/index.ts`                                        | `InstallableSkillCatalogItem` 等类型；channels `skill:list-installable` / `skill:install-catalog` / `skill:install-status` / `skill:uninstall-catalog`；流 `stream:skill:install-progress` |
| `apps/desktop/src/main/ipc/index.ts`                                        | 注册上述 channel；安装时用 `pushStreamEvent` 推送进度                                                                                                                                      |
| `apps/desktop/src/renderer/design/views/SkillStoreView.tsx`                 | 「精选技能」Tab + `InstallableSkillCard`（卡片、安装/卸载、进度、postInstallHint 提示）                                                                                                    |
| `minio/spark-desktop/artifact-repository/v1/index.json`                     | 要上传到 MinIO 的自建安装源 manifest；包含 `recommendedSkills`、技能包、运行时安装包、sha256 和 size                                                                                        |

## 不应进入 MinIO 的技能

`apps/desktop/resources/skills/` 下的随包内置技能不应再上传到自建安装源，例如：

`browser-use`、`canvas-studio`、`claude-api`、`commit`、`echarts`、`find-skills`、`frontend-design`、`multi-search-engine`、`platform-manager`、`react`、`skill-creator`、`spark-debug`、`spark-web-tool`、`ui-ux-pro-max`。

这些技能已经在安装包内，启动时由 `SkillService` 从 bundled skills 目录导入/同步；MinIO 重复维护只会增加上传体积和版本漂移风险。

## 如何新增一个「可安装技能」

1. 在 `installable-catalog.ts` 的 `INSTALLABLE_SKILL_CATALOG` 追加一项：
   ```ts
   {
     id: 'my-skill',            // 卡片唯一标识
     slug: 'my-skill',          // 落盘目录名（去重 / 状态匹配用）
     name: 'My Skill',
     description: '一句话描述',
     icon: '🧩',
     author: '作者',
     tags: ['tag1', 'tag2'],
     source: {
       type: 'artifact',
       artifactId: 'skill.my-skill',
       manifestUrl: 'https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/index.json',
       fallback: {
         type: 'tarball',
         repo: 'owner/name',
         ref: 'main',
         path: 'skills/my-skill', // 仓库内含 SKILL.md 的目录
       },
     },
     homepageUrl: 'https://github.com/owner/name',
     postInstallHint: '可选：安装后依赖提示（如 pip install ...）',
   }
   ```
2. 无需改其它代码。重启应用，「精选技能」Tab 即出现新卡片。

## 与既有体系的关系

- **不进 `ensureBuiltInSkills()`**：catalog 技能是「可安装」而非「已内置」，启动时只读取清单用于展示，不自动落库。
- **安装后等同本地技能**：落盘到 `{userData}/skills/<slug>/`，DB 记录 `scope=user`、`id=skill:catalog:<指纹>`，可启用 / 挂会话 / 卸载，与手动导入/软链技能完全一致。
- **依赖提示**：`postInstallHint` 在安装成功后以 toast 形式提示用户（如 ppt-master 需 `pip install -r requirements.txt`）。技能本身在 `SKILL.md` 内也会说明，用户首次使用时 Agent 会按原装流程引导。
- **与内置浏览器自动化 MCP 不冲突**：`playwright` CLI 技能靠 `npx @playwright/cli` 工作，与内置的 `@playwright/mcp` managed MCP 是两套互补能力。

## 当前收录

| 分组             | 技能                                                                                                                                            | 说明                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| PPT / 演示       | `ppt-master`                                                                                                                                    | AI 驱动 SVG→原生可编辑 PPTX 全链路 |
| 浏览器 CLI       | `playwright`                                                                                                                                    | 终端 Playwright CLI 技能            |
| Superpowers 流程 | `superpowers-*` 共 14 个：brainstorming、writing-plans、executing-plans、TDD、debugging、verification、code review、subagent、worktree、skills | Agent 工程流程与质量控制            |
| GitNexus         | `gitnexus-cli`、`gitnexus-exploring`、`gitnexus-impact-analysis`、`gitnexus-debugging`、`gitnexus-refactoring`、`gitnexus-guide`                | 代码语义索引、影响分析和调试        |
| AI 影视 / 剧作   | `screenwriting-lab`、`ai-film-production`、`hyperframes*`、`website-to-hyperframes`、`gsap-animation`、`scroll-storyteller`、`nano-banana`      | 剧本、分镜、AI 视频、动效与视觉素材 |

`index.json` 同时包含 Python/Node.js 运行时安装包，以及 `ppt-master` 的三平台 Python 3.11 wheelhouse：`macos-arm64`、`win-x64`、`linux-x64`。PyMuPDF、Pillow、numpy、lxml 等大包均已按平台纳入；目录位于 `dependencies/python-wheelhouse/ppt-master/`，用于和 `runtimes/python/` 的 Python 安装包区分开。
