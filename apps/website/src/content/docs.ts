/**
 * 文档主题索引 —— 所有文档主题的元信息集中在这里。
 *
 * 主题正文（真正可读的内容）按主题拆到 `docs-pages/<slug>.tsx`，
 * 每个文件一个独立 chunk 通过 React.lazy 按需加载。
 *
 * 改主题时只需：
 *   1) 在 docs.ts 的 `docsTopics` 加/删一条
 *   2) 在 docs-pages/ 下新增/删除对应 .tsx 文件
 *   3) 在 App.tsx 的 `docPageLoaders` 加/删对应的 lazy import
 */

export type DocCategory =
  | 'getting-started' // 入门 / 安装
  | 'code' // 代码开发
  | 'team' // 团队 Agent
  | 'canvas' // 无限画布
  | 'content' // 内容与媒体生产
  | 'provider' // 模型 / 多媒体 Provider
  | 'mcp' // MCP / Skills / 工具
  | 'governance' // 权限 / 治理
  | 'release' // 发布 / 更新

export interface DocsTopicMeta {
  /** URL 段：/docs/<slug> */
  slug: string
  /** 浏览器标签与 hero 区显示的标题 */
  title: string
  /** 一句话说明，用于卡片 / meta description / 搜索结果 */
  description: string
  /** 卡片副标题（在 DocsPage 主题导航里展示的细节） */
  detail: string
  /** 主题所属分类，决定 DocsPage 上的分组 */
  category: DocCategory
  /** 主题级别标签，便于筛选 */
  level: 'beginner' | 'intermediate' | 'advanced'
  /** 用于全文检索的关键词（标题 / 描述之外再补充） */
  keywords: string[]
  /** 预计阅读时长（分钟），给读者一个心理预期 */
  readTime: number
  /** 文档最近一次核对 / 更新日期，ISO YYYY-MM-DD */
  updatedAt: string
  /** 在 GitHub 仓库中的原始 md 路径，给想看完整版本的用户跳转 */
  githubSource?: string
  /** 同主题里互相跳转的相关主题 slug */
  relatedSlugs?: string[]
  /** lucide-react 图标名（在 DocsPage 卡片上展示） */
  icon:
    | 'Sparkles'
    | 'TerminalSquare'
    | 'Users'
    | 'LayoutGrid'
    | 'FileText'
    | 'ImageIcon'
    | 'Search'
    | 'Globe'
    | 'Cable'
    | 'RefreshCw'
    | 'PackageOpen'
    | 'AppWindow'
    | 'Boxes'
    | 'ShieldCheck'
}

export const docsTopics: DocsTopicMeta[] = [
  {
    slug: 'quick-start',
    title: '快速开始',
    detail: '从安装到完成第一个真实任务',
    description:
      'Spark Agent 快速开始指南：下载适合你系统的安装包、完成首次启动、接入模型服务、创建第一个 Agent 并完成第一个任务。',
    category: 'getting-started',
    level: 'beginner',
    keywords: ['安装', '下载', '首次启动', '快速开始', 'quick start', 'getting started'],
    readTime: 5,
    updatedAt: '2026-07-05',
    icon: 'Sparkles',
    relatedSlugs: ['agents-workflows', 'desktop-guide', 'auto-update'],
  },
  {
    slug: 'code-development',
    title: '代码开发',
    detail: 'Worktree、终端、审查与补丁',
    description:
      '在 Spark Agent 中做真实的代码开发：打开项目、选择分支、用 Git Worktree 隔离、在终端跑验证、逐文件审查 AI 改动并生成 Pull Request。',
    category: 'code',
    level: 'intermediate',
    keywords: ['代码', 'worktree', '终端', '审查', 'PR', 'code development', 'review'],
    readTime: 7,
    updatedAt: '2026-06-29',
    icon: 'TerminalSquare',
    relatedSlugs: ['agents-workflows', 'team-mode', 'remote-connections'],
  },
  {
    slug: 'agents-workflows',
    title: 'Agent 工作流',
    detail: 'Agent 配置、真实执行工作流、工具选择与上下文',
    description:
      'Spark Agent 中 Agent 的工作机制：默认 Agent、Provider/Model/Skill/Rule/MCP 组合、可真实执行的 Workflow Graph、workflow_run、运行快照与 [Runtime Rules] 段。',
    category: 'team',
    level: 'intermediate',
    keywords: ['Agent', '工作流', 'workflow', 'skills', 'rules', 'MCP', 'spark_platform'],
    readTime: 10,
    updatedAt: '2026-07-03',
    icon: 'Users',
    githubSource: 'docs/agents-workflows.md',
    relatedSlugs: ['team-mode', 'mcp-skills', 'web-search', 'browser-automation'],
  },
  {
    slug: 'team-mode',
    title: '团队模式',
    detail: 'Host / Member 调度、事件流与预算',
    description:
      'Spark Agent 团队模式（Team Mode）：Host Agent 把子任务分派给多个 Member Agent，每个 Member 有独立模型/工具/Skills，事件流式展示分派、回复与完成。',
    category: 'team',
    level: 'advanced',
    keywords: ['团队', '多 Agent', 'host', 'member', 'dispatch', 'agent_dispatch'],
    readTime: 9,
    updatedAt: '2026-06-29',
    icon: 'Boxes',
    githubSource: 'docs/agents-workflows.md#team-mode-agent-to-agent',
    relatedSlugs: ['agents-workflows', 'governance'],
  },
  {
    slug: 'canvas-mvp',
    title: '无限画布',
    detail: '节点、资产、任务、影视创作与生成链路',
    description:
      'Spark Agent 无限画布（Infinite Canvas）能力全景：项目管理、节点类型、AI 操作、任务队列、生成结果节点、lineage 边、资产中心、媒体任务路由与持久化。',
    category: 'canvas',
    level: 'intermediate',
    keywords: ['画布', 'canvas', '节点', 'asset', 'task', 'lineage', '影视', 'storyboard', '360', '全景', 'panorama', 'equirectangular', '菜单'],
    readTime: 12,
    updatedAt: '2026-06-29',
    icon: 'LayoutGrid',
    githubSource: 'docs/ai-infinite-canvas-mvp.md',
    relatedSlugs: ['media-providers', 'image-providers', 'content-production'],
  },
  {
    slug: 'media-providers',
    title: '多媒体 Provider',
    detail: '图片、语音、视频的统一能力注册与平台适配',
    description:
      'Spark Agent 多媒体 Provider 配置：图片生成 / 编辑、语音合成 / 转写、视频生成 / 图生视频 / 视频编辑的统一能力注册表、平台适配器（APIMart / xAI / 火山 / 百炼 / 可灵 / Hailuo 等）。',
    category: 'provider',
    level: 'advanced',
    keywords: ['media', 'provider', 'apimart', 'xai', 'volcengine', 'bailian', 'kling', 'spark_media'],
    readTime: 14,
    updatedAt: '2026-06-29',
    icon: 'FileText',
    githubSource: 'docs/multimedia-model-providers.md',
    relatedSlugs: ['image-providers', 'canvas-mvp'],
  },
  {
    slug: 'image-providers',
    title: '图片生成 Provider',
    detail: 'spark_image MCP 与图片模型适配',
    description:
      'Spark Agent 图片生成 Provider：imageProvider / imageApiType 字段、内置预设（OpenAI、APIMart、OpenRouter、Gemini、Seedream 等）、spark_image MCP 工具、.spark-artifacts/images 输出目录、与 spark_media 统一栈的关系。',
    category: 'provider',
    level: 'intermediate',
    keywords: ['image', '生图', 'imageProvider', 'spark_image', 'seedream', 'openai image'],
    readTime: 6,
    updatedAt: '2026-06-29',
    icon: 'ImageIcon',
    githubSource: 'docs/image-generation-providers.md',
    relatedSlugs: ['media-providers', 'canvas-mvp'],
  },
  {
    slug: 'web-search',
    title: '联网搜索',
    detail: 'spark_search MCP、免密链与 keyed 后端',
    description:
      'Spark Agent 内置联网搜索 spark_search：web_search / fetch_url 工具、免密默认链（Bing / 百度 / DuckDuckGo）、keyed 后端（博查 / Tavily / Serper）、配置项与降级策略。',
    category: 'mcp',
    level: 'beginner',
    keywords: ['搜索', 'web_search', 'fetch_url', 'Bing', 'DuckDuckGo', 'bocha', 'tavily', '联网'],
    readTime: 4,
    updatedAt: '2026-06-29',
    icon: 'Search',
    githubSource: 'docs/builtin-web-search.md',
    relatedSlugs: ['browser-automation', 'mcp-skills'],
  },
  {
    slug: 'browser-automation',
    title: '浏览器自动化',
    detail: 'Playwright MCP 与 spark_browser 可见窗口',
    description:
      'Spark Agent 浏览器自动化：Playwright managed MCP 负责网页流程，spark_browser 内置 MCP 提供应用内可见窗口、本地 HTML 调试、console/network 和 profile 登录态。',
    category: 'mcp',
    level: 'intermediate',
    keywords: ['playwright', 'browser', 'spark_browser', 'console', 'network', 'mcp__playwright', 'browser_navigate'],
    readTime: 6,
    updatedAt: '2026-07-05',
    icon: 'Globe',
    githubSource: 'docs/skills/browser-automation.md',
    relatedSlugs: ['web-search', 'mcp-skills'],
  },
  {
    slug: 'remote-connections',
    title: '远程连接',
    detail: 'Telegram / 飞书 桥接',
    description:
      'Spark Agent 远程连接（Telegram / 飞书）：连接配置、配对流程、本地 webhook（127.0.0.1:32178）、内置命令（/help /sessions /models 等）、启动项集成。',
    category: 'governance',
    level: 'intermediate',
    keywords: ['remote', 'telegram', 'feishu', 'webhook', '/bind'],
    readTime: 9,
    updatedAt: '2026-06-29',
    icon: 'Cable',
    githubSource: 'docs/remote-connections.md',
    relatedSlugs: ['governance'],
  },
  {
    slug: 'auto-update',
    title: '自动更新',
    detail: 'GitHub Release + 官网版本中心 + UpdateService',
    description:
      'Spark Agent 桌面端自动更新：electron-builder + GitHub Release + 官网版本中心（spark.yiqibyte.com）、UpdateService 检查/下载/安装状态、应用内更新入口、stable/beta 通道、Windows / macOS 签名构建。',
    category: 'release',
    level: 'intermediate',
    keywords: ['更新', 'update', 'release', 'electron-builder', 'WIN_CSC_LINK', 'CSC_LINK'],
    readTime: 8,
    updatedAt: '2026-06-29',
    icon: 'RefreshCw',
    githubSource: 'docs/github-release-auto-update.md',
    relatedSlugs: ['quick-start', 'desktop-guide'],
  },
  {
    slug: 'mcp-skills',
    title: 'MCP 与 Skills',
    detail: '可安装技能、加载策略与按需读取',
    description:
      'Spark Agent MCP / Skills 体系：内置技能（apps/desktop/resources/skills）、可安装技能目录（INSTALLABLE_SKILL_CATALOG）、tarball 与 GitHub 两种安装路径、按需加载与运行时上下文注入。',
    category: 'mcp',
    level: 'intermediate',
    keywords: ['skill', 'SKILL.md', 'installable', 'tarball', 'spark_platform'],
    readTime: 7,
    updatedAt: '2026-06-29',
    icon: 'PackageOpen',
    githubSource: 'docs/builtin-installable-skills.md',
    relatedSlugs: ['agents-workflows', 'browser-automation', 'web-search'],
  },
  {
    slug: 'governance',
    title: '权限与治理',
    detail: '审批、Rules、Hooks、用量账本与审计',
    description:
      'Spark Agent 权限治理：高风险操作审批（删除 / 联网 / 写文件）、Rules 约束 Agent 行为、Hooks 在工具调用前后插入自定义逻辑、用量账本、审计面板与事件流。',
    category: 'governance',
    level: 'advanced',
    keywords: ['权限', 'permission', 'rules', 'hooks', '审计', 'audit', 'approval', '用量'],
    readTime: 6,
    updatedAt: '2026-06-29',
    icon: 'ShieldCheck',
    relatedSlugs: ['team-mode', 'remote-connections'],
  },
  {
    slug: 'desktop-guide',
    title: '桌面端架构',
    detail: 'Renderer / Main / IPC / 服务层与本地数据',
    description:
      'Spark Agent 桌面端架构总览：Electron 主进程 / 渲染进程 / Preload / IPC 桥、Agent Runtime 服务层（Provider / Session / Skill / MCP / Permission）、SQLite 与本地文件存储、Keychain 凭据存储。',
    category: 'getting-started',
    level: 'advanced',
    keywords: ['desktop', 'electron', 'renderer', 'main', 'IPC', 'sqlite', 'keytar'],
    readTime: 10,
    updatedAt: '2026-06-29',
    icon: 'AppWindow',
    githubSource: 'docs/desktop-agent-development-guide.md',
    relatedSlugs: ['quick-start', 'code-development'],
  },
  {
    slug: 'builtin-tools',
    title: '内置工具',
    detail: '15 个内置 Skill 全览与挑选指南',
    description:
      'Spark Agent 应用内置的全部 15 个 Skill 教程：claude-api / commit / react / frontend-design / skill-creator / multi-search-engine / browser-use / canvas-studio / multimedia-use / spark-web-tool / echarts / ui-ux-pro-max / spark-debug / find-skills / platform-manager。每条都说明触发场景、典型使用、跳过条件与配套 MCP。',
    category: 'mcp',
    level: 'intermediate',
    keywords: ['Skill', 'SKILL.md', '工具', '内置', 'browser-use', 'commit', 'echarts', 'spark-debug'],
    readTime: 12,
    updatedAt: '2026-07-08',
    icon: 'PackageOpen',
    relatedSlugs: ['mcp-skills', 'browser-automation', 'web-search', 'agents-workflows'],
  },
  {
    slug: 'long-term-memory',
    title: '长期记忆',
    detail: '三层作用域、后台抽取、混合检索与整合进化',
    description:
      'Spark Agent 三层长期记忆系统：User / Project / Agent 作用域隔离不串味，后台独立 LLM 抽取（与 OpenAI Memory、Mem0 同款架构）不干扰主对话，FTS5+sqlite-vec 混合检索，自动整合进化，search_memory / recall_memory 工具按需深挖。',
    category: 'mcp',
    level: 'intermediate',
    keywords: ['长期记忆', 'memory', 'search_memory', 'recall_memory', 'FTS5', 'sqlite-vec', 'Mem0', '记忆抽取', 'scope'],
    readTime: 6,
    updatedAt: '2026-07-04',
    icon: 'Boxes',
    relatedSlugs: ['builtin-tools', 'agents-workflows', 'mcp-skills'],
  },
  {
    slug: 'workflow-usage',
    title: '工作流编排',
    detail: '真实执行、节点配置、编码流程与排错',
    description:
      'Spark Agent 工作流（Workflow）使用教程：面向非 IT 用户的快速配置、11 种节点类型、workflow_run 真实执行、运行快照与恢复、toolIds / skillIds / mcpServerIds 专业配置，以及程序编码开发 / 调研报告 / 发布前自检模板。',
    category: 'team',
    level: 'intermediate',
    keywords: ['工作流', 'workflow', '编排', 'node', 'ReactFlow', '节点', 'graph', 'workflow_run', '编码工作流', 'plan / verify / approval'],
    readTime: 16,
    updatedAt: '2026-07-03',
    icon: 'Boxes',
    relatedSlugs: ['agents-workflows', 'builtin-tools', 'governance'],
  },
  {
    slug: 'board-view',
    title: '任务面板',
    detail: '6 个状态列、拖拽、内联编辑与回收站',
    description:
      'Spark Agent 任务面板（BoardView）使用教程：6 个状态列（todo / in-progress / bug-fix / done / accepted / closed）、TaskCard 完整字段（id / title / description / status / priority / assignee / project / tags / dueDate / processingAgent / acceptanceCriteria / testAgent / comments / attachments / sortOrder）、内联创建 / 编辑、拖拽改变状态、右键菜单、回收站软删除、多维筛选、通过 platform-manager Skill 让 Agent 自动操作。',
    category: 'governance',
    level: 'beginner',
    keywords: ['看板', 'board', '任务面板', 'kanban', 'todo', 'in-progress', 'accepted', '回收站'],
    readTime: 10,
    updatedAt: '2026-06-29',
    icon: 'FileText',
    relatedSlugs: ['team-mode', 'governance', 'builtin-tools'],
  },
]

export const categoryLabels: Record<DocCategory, string> = {
  'getting-started': '入门',
  code: '代码开发',
  team: '团队 Agent',
  canvas: '无限画布',
  content: '内容与媒体生产',
  provider: 'Provider',
  mcp: 'MCP & 工具',
  governance: '治理',
  release: '发布',
}

export const categoryOrder: DocCategory[] = [
  'getting-started',
  'code',
  'team',
  'canvas',
  'provider',
  'mcp',
  'governance',
  'release',
]

export function findDocsTopic(slug: string): DocsTopicMeta | undefined {
  return docsTopics.find((t) => t.slug === slug)
}

export function docsTopicsByCategory(category: DocCategory): DocsTopicMeta[] {
  return docsTopics.filter((t) => t.category === category)
}

export function relatedDocsTopics(slug: string): DocsTopicMeta[] {
  const t = findDocsTopic(slug)
  if (!t?.relatedSlugs?.length) return []
  return t.relatedSlugs
    .map((s) => findDocsTopic(s))
    .filter((x): x is DocsTopicMeta => Boolean(x))
}
