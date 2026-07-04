export interface FeatureGroup {
  title: string
  icon: string
  summary: string
  href: string
  proof: string
  items: string[]
}

export const featureGroups: FeatureGroup[] = [
  {
    title: '可真实执行的工作流编排',
    icon: 'runtime',
    summary: '把重复任务做成一张流程图：需求输入、计划、执行、审批、验证、复核和交付物按节点自动推进。',
    href: '/docs/workflow-usage',
    proof: '适合把代码开发、资料整理、发布自检和内容生产沉淀成团队可复用流程',
    items: [
      '工作流不只是提示词模板，Claude SDK 路径可通过 workflow_run 真实驱动节点执行',
      'agent / subagent 节点可派发专属 Agent，input / approval / verify 等节点由系统侧稳定处理',
      '支持运行快照、失败节点记录、恢复执行和审计回看，适合长期流程治理',
    ],
  },
  {
    title: '360 全景面板统一方案',
    icon: 'runtime',
    summary: '让对话、文件、终端、Diff、任务、画布和工具面板在同一工作台协同，而不是四处跳转。',
    href: '/features#coding',
    proof: '适合需要同时看上下文、执行过程和交付产物的重度工作流',
    items: [
      '同屏推进对话、代码改动、命令执行、任务状态和结果审查',
      '内容生产时继续承接画布、媒体生成和资产流转，不用换系统',
      '所有关键面板围绕项目组织，减少上下文丢失和切换成本',
    ],
  },
  {
    title: 'A2A 团队模式',
    icon: 'code',
    summary: '不是单 Agent 单线程干活，而是让主 Agent 组织一支可分工、可汇总、可审查的执行团队。',
    href: '/features#team',
    proof: '适合复杂交付、跨角色协作和需要复盘的团队任务',
    items: [
      '把编码、审查、调研、内容生产拆给不同 Agent 并行推进',
      '每个成员 Agent 可单独配置模型、工具、Skills、MCP 和上下文',
      '通过群聊式事件流回看分派、执行、交接和汇总过程',
    ],
  },
  {
    title: '双内核执行体系',
    icon: 'audit',
    summary: '同一工作台里同时支持偏协作编排的 Agent Runtime 和偏开发执行的 Codex 路径，各自做擅长的事。',
    href: '/features#runtime',
    proof: '适合既要长流程协作，也要真实落地代码和命令的团队',
    items: [
      'Claude Agent SDK 负责长流程、多工具调用和多 Agent 协作',
      'Codex 负责补丁编辑、CLI 执行和开发任务闭环',
      '按任务切换执行路径，不必为了不同能力分裂工具链',
    ],
  },
  {
    title: '调试模式与内置工具链',
    icon: 'canvas',
    summary: '把搜索、日志、浏览器自动化、终端和调试面板内建进工作台，定位问题不靠猜。',
    href: '/features#tools',
    proof: '适合排查前后端问题、复现复杂 bug 和验证自动化结果',
    items: [
      '调试模式把执行过程、诊断信息和关键状态暴露给使用者',
      '内置搜索、终端、浏览器自动化和媒体相关工具可直接调用',
      '任务面板承接长流程，让排查、验证和修复在同一处闭环',
    ],
  },
  {
    title: '项目资产表与知识沉淀',
    icon: 'team',
    summary: '把角色、场景、Prompt、脚本、镜头、规范和交付资产整理成项目级可复用资源。',
    href: '/canvas#film',
    proof: '适合长期项目、多批次内容生产和资产复用',
    items: [
      '集中管理剧本、角色、场景、道具、特效和提示词资产',
      '项目资产表让团队按统一字段沉淀素材、状态和引用关系',
      '同一份资产可继续流转到画布、分镜、视频和交付环节',
    ],
  },
  {
    title: '在线幻灯片与自定义网页交付',
    icon: 'film',
    summary: '内置 spark-web-tool，把讲解、汇报和专题内容直接做成交付级在线幻灯片或定制网页。',
    href: '/features#tools',
    proof: '适合方案汇报、课程内容、专题讲解和品牌化网页交付',
    items: [
      '支持 HTML 在线幻灯片生成，适合演示、培训和远程讲解',
      '支持自定义网页制作，不局限于翻页式 slide 结构',
      '同一会话里还能继续输出 PPTX、DOCX、Markdown 等多种文档产物',
    ],
  },
  {
    title: 'Skill 秒速安装与能力扩展',
    icon: 'film',
    summary: '团队经验不止写在文档里，而是可以打包成 Skill、脚本和素材，按任务快速装配。',
    href: '/features#runtime',
    proof: '适合把高频流程沉淀成标准能力并快速分发给团队',
    items: [
      'Skill 可携带说明、脚本、模板和素材，开箱即可执行',
      '支持快速安装与按需加载，减少重复配置和环境准备成本',
      '把团队最佳实践固化成可复用能力，而不是口口相传',
    ],
  },
  {
    title: '透明审计与可控自动化',
    icon: 'tools',
    summary: '重点不是“能自动做”，而是“自动做了什么、为什么这么做、你怎么兜底”都看得见。',
    href: '/features#audit',
    proof: '适合重视合规、安全和可追责过程的团队',
    items: [
      '追踪模型上下文、工具调用、文件改动、团队分派和用量记录',
      '高风险动作可挂权限审批、规则和 Hooks，避免静默越权执行',
      '逐块查看 AI 生成的改动，不满意可撤回或回到稳定状态再继续迭代',
    ],
  },
  {
    title: '多层级环境、规则与权限',
    icon: 'provider',
    summary: '从环境变量到规则、从权限到审批，按全局、项目、Agent 多层级治理自动化边界。',
    href: '/features#audit',
    proof: '适合需要自定义安全边界、隔离策略和运行约束的团队',
    items: [
      '多层级环境变量支持按系统、项目和任务注入运行配置',
      '多层级规则可约束上下文、工具使用和高风险动作',
      '权限模型支持自定义审批边界，避免 Agent 获得过量能力',
    ],
  },
  {
    title: '会沉淀会进化的长期记忆',
    icon: 'audit',
    summary: 'Agent 自动记住你的偏好、项目背景和长期约定，跨会话可用，越用越懂你而不是每次从零开始。',
    href: '/docs/long-term-memory',
    proof: '适合长期项目、个人偏好沉淀和团队约定积累',
    items: [
      '三层作用域隔离：跨项目通用的身份偏好、当前项目专属的决策背景、单个 Agent 的角色记忆各自独立，不会串味',
      '后台自动抽取不干扰对话：主对话用强模型推进任务，记忆沉淀走独立的便宜小模型，成本最优且故障不影响主流程',
      '会进化会整合：重复记忆自动合并、零散反馈自动升华为通用模式，关键词和语义混合检索都能命中',
    ],
  },
]

export const codeEvidence = [
  '桌面端本地运行，敏感项目上下文优先留在你的机器和 workspace 中',
  'Agent Runtime 统一管理会话、模型、MCP、团队协作、权限、用量、规则和记忆',
  '开发闭环覆盖终端、worktree、改动审查、调试模式和浏览器自动化',
  '媒体运行时统一路由模型能力、任务产物和图片/视频/语音服务适配',
  '本地数据层管理会话、团队、画布、技能、记忆、服务商、权限和用量记录',
]

export interface FeatureScreenshot {
  src: string
  title: string
  text: string
}

export const featureScreenshots: FeatureScreenshot[] = [
  {
    src: '/showcase/skills-hub.png',
    title: '技能快速安装',
    text: '精选技能一键安装完整原装的 Skill,装好后可在「已安装」中启用或挂到会话,团队经验秒变可执行能力。',
  },
  {
    src: '/showcase/team-mode.png',
    title: '工作流与团队模式',
    text: '用可视化工作流安排输入、计划、执行、验证和交付；复杂节点还能派发给不同 Agent 分工完成。',
  },
  {
    src: '/showcase/media-tools.png',
    title: '内置多媒体模型调用工具,即配即用',
    text: '图文、视频与语音模型统一在会话中调用,工具即配即用,生成结果直接进入项目资产。',
  },
  {
    src: '/showcase/dev-workspace.png',
    title: '代码审计',
    text: '侧栏可直接打开 Git Review,逐文件查看 AI 提交的 diff,接受、撤回或继续修改都有明确边界。',
  },
  {
    src: '/showcase/terminal.png',
    title: '内置终端',
    text: '工作台内嵌终端面板,无需切换窗口即可执行命令、查看输出并把执行过程留给会话复盘。',
  },
  {
    src: '/showcase/env-config.png',
    title: '项目 / 会话环境变量配置',
    text: '按项目与会话两个层级管理环境变量,键值仅在本机保存并注入运行环境,提示词中只暴露脱敏后的键名。',
  },
]
