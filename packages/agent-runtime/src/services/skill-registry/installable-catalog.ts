/**
 * @module skill-registry/installable-catalog
 *
 * 内置「可安装技能目录」（Installable Skill Catalog）
 *
 * 这是一份**写死在代码里**的清单，用来在技能商店里展示「精选 / 可一键安装」的技能卡片。
 * 与已安装的技能（DB 中的 skills 表）和远程市场源（skill_registries 表）不同：
 *   - 它**不落库**，纯展示；
 *   - 它**不依赖联网**——新机器装完应用即可看到这些卡片；
 *   - 真正的技能内容在用户点击「安装」时才从 Spark 自建 artifact 源按需下载（完整原装，不裁剪）。
 *
 * 设计目的：让 `ppt-master` / `superpowers-*` / `gitnexus-*` 这类体积较大、或不便随包内置的技能，
 * 以「卡片 + 一键安装」的形式开箱可用，而不会撑大安装包体积。
 *
 * 新增一个可安装技能时，往 INSTALLABLE_SKILL_CATALOG 追加一项即可，无需改其它代码。
 */

/** 可安装技能的来源 */
export type GithubInstallableSkillSource = {
  /** 走 GitHub Contents API 逐文件下载（≤60 文件 / 单文件 ≤1MB 的小技能） */
  type: 'github'
  /** 形如 "owner/name" */
  repo: string
  /** 分支 / 标签 / commit，缺省取默认分支 */
  ref?: string
  /** 仓库内技能目录（相对于仓库根），缺省为根 */
  path?: string
}

export type TarballInstallableSkillSource = {
  /** 走 tarball 整库下载（突破 GitHub Contents API 60 文件 / 1MB 限制，适合大体量技能） */
  type: 'tarball'
  /** 形如 "hugohe3/ppt-master" */
  repo: string
  /** 分支 / 标签 / commit，缺省取默认分支 */
  ref?: string
  /** 仓库内技能目录（相对于仓库根），缺省为根 */
  path?: string
}

export type ArtifactInstallableSkillSource = {
  /** 走 Spark 自建 artifact 仓库（MinIO/OSS 等），按 manifest 中的 zip 包落盘 */
  type: 'artifact'
  /** manifest 中的 artifact id */
  artifactId: string
  /** manifest URL，缺省使用 Spark 官方自建安装源 */
  manifestUrl?: string
  /** artifact 源不可用时的兜底来源 */
  fallback?: TarballInstallableSkillSource | GithubInstallableSkillSource
}

export type InstallableSkillSource =
  | ArtifactInstallableSkillSource
  | TarballInstallableSkillSource
  | GithubInstallableSkillSource

export const DEFAULT_SPARK_INSTALL_MANIFEST_URL =
  process.env.SPARK_INSTALL_MANIFEST_URL ||
  'https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/index.json'

/** 内置可安装技能清单中的一条 */
export interface InstallableSkillCatalogItem {
  /** 卡片唯一标识（不进 DB，仅用于前端 key / 安装状态匹配） */
  id: string
  /** 落盘后的目录名（slug），安装状态判断与去重都以此为准 */
  slug: string
  /** 显示名 */
  name: string
  /** 一句话描述 */
  description: string
  /** 图标 emoji（卡片占位图标） */
  icon: string
  /** 作者 / 来源标注 */
  author: string
  /** 标签 */
  tags: string[]
  /** 来源信息 */
  source: InstallableSkillSource
  /** 主页 URL（可选，卡片「查看来源」按钮） */
  homepageUrl?: string
  /**
   * 安装后是否需要额外的运行时依赖（如 Python 包）。
   * 若给出，安装完成时会在 UI 上提示用户执行相应命令。
   */
  postInstallHint?: string
}

function sparkArtifactSkill(options: {
  slug: string
  name: string
  description: string
  icon: string
  author: string
  tags: string[]
  homepageUrl?: string
  postInstallHint?: string
}): InstallableSkillCatalogItem {
  const item: InstallableSkillCatalogItem = {
    id: options.slug,
    slug: options.slug,
    name: options.name,
    description: options.description,
    icon: options.icon,
    author: options.author,
    tags: options.tags,
    source: {
      type: 'artifact',
      artifactId: `skill.${options.slug}`,
      manifestUrl: DEFAULT_SPARK_INSTALL_MANIFEST_URL,
    },
  }
  if (options.homepageUrl !== undefined) item.homepageUrl = options.homepageUrl
  if (options.postInstallHint !== undefined) item.postInstallHint = options.postInstallHint
  return item
}

const NODE_RUNTIME_HINT =
  '若技能需要 Node.js/npm/npx，先检查 Spark 桌面端是否暴露了内置 Electron Node（SPARK_ELECTRON_NODE + ELECTRON_RUN_AS_NODE=1）或 manifest 中的 Node.js 包；不可用时再用国内镜像/外网安装系统 Node.js。'

const SUPERPOWERS_SKILLS = [
  ['superpowers-using-superpowers', 'Using Superpowers', '技能调用总入口，帮助 agent 在任务开始时按需加载合适的 Superpowers 工作流。'],
  ['superpowers-brainstorming', 'Brainstorming', '在创意、产品和实现方向不清晰时，用结构化提问把模糊需求收敛成可执行方案。'],
  ['superpowers-writing-plans', 'Writing Plans', '把多步骤功能开发拆成可执行计划，明确文件、步骤、验证和交付边界。'],
  ['superpowers-executing-plans', 'Executing Plans', '按既定实施计划逐步执行、验证和汇报，适合较长的工程任务。'],
  ['superpowers-test-driven-development', 'Test Driven Development', '用红绿重构节奏实现功能或修 bug，先写失败测试再实现。'],
  ['superpowers-systematic-debugging', 'Systematic Debugging', '用假设、证据和最小复现来定位复杂 bug，避免盲改。'],
  ['superpowers-verification-before-completion', 'Verification Before Completion', '在声称完成前强制运行验证命令，确保结论有新鲜证据支撑。'],
  ['superpowers-requesting-code-review', 'Requesting Code Review', '在完成较大变更后组织代码审查，聚焦风险、回归和缺失测试。'],
  ['superpowers-receiving-code-review', 'Receiving Code Review', '处理审查反馈时逐条确认、修复和复验，避免漏项。'],
  ['superpowers-dispatching-parallel-agents', 'Dispatching Parallel Agents', '把互不依赖的调研或实现任务拆给多个子 agent 并行处理。'],
  ['superpowers-subagent-driven-development', 'Subagent Driven Development', '按任务分派子 agent、主 agent 审阅整合，适合大型计划执行。'],
  ['superpowers-using-git-worktrees', 'Using Git Worktrees', '为隔离开发创建和管理 git worktree，减少脏工作区互相干扰。'],
  ['superpowers-finishing-a-development-branch', 'Finishing Development Branch', '收尾开发分支：验证、整理变更、准备提交或 PR。'],
  ['superpowers-writing-skills', 'Writing Skills', '创建或维护 agent skill 时的结构、触发描述、验证和打包指南。'],
] as const

const GITNEXUS_SKILLS = [
  ['gitnexus-cli', 'GitNexus CLI', '运行 GitNexus analyze/status/wiki/list 等 CLI 命令，维护本地代码语义索引。'],
  ['gitnexus-exploring', 'GitNexus Exploring', '用 GitNexus 查询执行流和代码结构，快速理解陌生模块。'],
  ['gitnexus-impact-analysis', 'GitNexus Impact Analysis', '修改符号前分析上游影响范围，评估直接调用方、流程和风险等级。'],
  ['gitnexus-debugging', 'GitNexus Debugging', '调试时结合调用图、执行流和上下文定位根因。'],
  ['gitnexus-refactoring', 'GitNexus Refactoring', '重命名、抽取、拆分或移动代码时使用语义图降低误改风险。'],
  ['gitnexus-guide', 'GitNexus Guide', '了解 GitNexus 能力、资源、命令和常见工作流。'],
] as const

const FILM_AND_STORY_SKILLS = [
  ['screenwriting-lab', 'Screenwriting Lab', '剧本创作与改稿：logline、人物弧光、节拍表、场景大纲、对白润色和覆盖意见。', '🎬'],
  ['ai-film-production', 'AI Film Production', 'AI 影视制作流程：分镜、镜头表、图像/视频提示词、连续性控制、声音与剪辑交付。', '🎞️'],
  ['hyperframes', 'HyperFrames', '用 HTML / GSAP 创作视频合成、字幕、转场、片头、旁白和音频响应动画。', '🎥'],
  ['hyperframes-cli', 'HyperFrames CLI', 'HyperFrames 项目的初始化、预览、渲染、转写、TTS 和 lint 命令指南。', '🧰'],
  ['hyperframes-registry', 'HyperFrames Registry', '安装并接入 HyperFrames registry blocks/components，快速搭建视频片段。', '📦'],
  ['hyperframes-gsap', 'HyperFrames GSAP', 'HyperFrames 场景中的 GSAP 时间线、缓动、动画编排和性能实践。', '🎛️'],
  ['website-to-hyperframes', 'Website To HyperFrames', '把网站捕获成产品宣传片、社媒广告或产品 tour 视频。', '🌐'],
  ['gsap-animation', 'GSAP Animation', 'GSAP + Remotion 专业动态图形制作：时间线、文字拆分、SVG morph 和动效预设。', '✨'],
  ['scroll-storyteller', 'Scroll Storyteller', '创建滚动叙事、视觉长页、聚光灯交互和沉浸式故事页面。', '📜'],
  ['nano-banana', 'Nano Banana', '通过 Gemini 原生图像模型生成或编辑图片，用于视觉开发和素材生成。', '🍌'],
  ['illustrated-slides-with-nano-banana', 'Illustrated Slides With Nano Banana', '用 AI 生成整页插画式幻灯片，适合视觉提案、分镜风格稿和图像化 deck。', '🖼️'],
] as const

function workflowSkill([slug, name, description]: readonly [string, string, string]): InstallableSkillCatalogItem {
  return sparkArtifactSkill({
    slug,
    name,
    description,
    icon: '⚡',
    author: 'OpenAI Curated / Superpowers',
    tags: ['workflow', 'agent', 'superpowers', '工程流程'],
  })
}

function gitnexusSkill([slug, name, description]: readonly [string, string, string]): InstallableSkillCatalogItem {
  return sparkArtifactSkill({
    slug,
    name,
    description,
    icon: '🧭',
    author: 'GitNexus',
    tags: ['gitnexus', 'code-intelligence', 'callgraph', '代码理解'],
    postInstallHint: NODE_RUNTIME_HINT,
  })
}

function filmSkill([
  slug,
  name,
  description,
  icon,
]: readonly [string, string, string, string]): InstallableSkillCatalogItem {
  const options: {
    slug: string
    name: string
    description: string
    icon: string
    author: string
    tags: string[]
    postInstallHint?: string
  } = {
    slug,
    name,
    description,
    icon,
    author: slug.startsWith('hyperframes') || slug === 'website-to-hyperframes'
      ? 'OpenAI Curated / HyperFrames'
      : 'Spark Curated',
    tags: ['film', 'story', 'video', 'ai-video', '影视制作'],
  }
  if (slug.includes('hyperframes') || slug.includes('gsap') || slug.includes('nano-banana')) {
    options.postInstallHint = NODE_RUNTIME_HINT
  }
  return sparkArtifactSkill(options)
}

/**
 * 内置可安装技能目录。
 *
 * 当前收录：
 *   - ppt-master：高质量原生可编辑 PPTX 生成（SVG → PPTX 全链路）。
 *   - superpowers / gitnexus / AI 影视制作等非安装包内置技能。
 *
 * 注：推荐技能只收录未随应用安装包内置的技能；应用内置技能不要重复放进自建 artifact 仓库。
 */
export const INSTALLABLE_SKILL_CATALOG: readonly InstallableSkillCatalogItem[] = [
  {
    id: 'ppt-master',
    slug: 'ppt-master',
    name: 'PPT Master',
    description:
      'AI 驱动的多格式 SVG 内容生成系统：把 PDF / DOCX / URL / Markdown 转成高质量 SVG 页面并导出为原生可编辑 PPTX（真实 DrawingML 形状 / 文本框 / 图表 / 动画）。',
    icon: '📊',
    author: 'Hugo He',
    tags: ['pptx', 'presentation', 'powerpoint', 'svg', 'drawingml', '演示文稿'],
    source: {
      type: 'artifact',
      artifactId: 'skill.ppt-master',
      manifestUrl: DEFAULT_SPARK_INSTALL_MANIFEST_URL,
      fallback: {
        type: 'tarball',
        repo: 'hugohe3/ppt-master',
        ref: 'main',
        path: 'skills/ppt-master',
      },
    },
    homepageUrl: 'https://github.com/hugohe3/ppt-master',
    postInstallHint:
      '该技能依赖 Python 3.11+、Node.js 以及一组 Python 包。国内/弱网环境请优先使用 Spark 自建安装源 manifest 中的 Python/Node.js 包和 ppt-master 平台专属 wheelhouse；当前已内置 macOS arm64、Windows x64、Linux x64 的 Python 3.11 wheelhouse。',
  },
  {
    id: 'playwright',
    slug: 'playwright',
    name: 'Playwright CLI',
    description:
      '微软官方 playwright-cli 技能：在终端驱动真实浏览器做导航、填表、截图、数据抓取与 UI 流程调试，靠 npx 调用，与内置的浏览器自动化 MCP 互补。',
    icon: '🎭',
    author: 'Microsoft',
    tags: ['browser', 'automation', 'e2e', 'playwright', '浏览器自动化'],
    source: {
      type: 'artifact',
      artifactId: 'skill.playwright',
      manifestUrl: DEFAULT_SPARK_INSTALL_MANIFEST_URL,
      fallback: {
        type: 'tarball',
        repo: 'microsoft/playwright-cli',
        ref: 'main',
        path: 'skills/playwright-cli',
      },
    },
    homepageUrl: 'https://github.com/microsoft/playwright-cli',
    postInstallHint:
      `运行时通过 npx 调用 @playwright/cli，需可用 Node.js/npm/npx。${NODE_RUNTIME_HINT} 浏览器内核优先使用应用内置/已配置的 Playwright 浏览器路径。`,
  },
  ...SUPERPOWERS_SKILLS.map(workflowSkill),
  ...GITNEXUS_SKILLS.map(gitnexusSkill),
  ...FILM_AND_STORY_SKILLS.map(filmSkill),
]

/** 按 slug 取条目 */
export function getInstallableSkillBySlug(slug: string): InstallableSkillCatalogItem | undefined {
  return INSTALLABLE_SKILL_CATALOG.find((item) => item.slug === slug)
}
