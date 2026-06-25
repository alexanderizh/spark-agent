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
    title: '代码开发与调试',
    icon: 'code',
    summary: '把聊天、终端、文件、差异和验证放在同一个开发回路里。',
    href: '/features#coding',
    proof: 'TerminalService、Git Review、Debug Mode、Browser automation',
    items: [
      '双内核代码 Agent：Claude SDK / Codex 可切换',
      '侧边聊天、内置终端、文件目录和任务面板统一',
      'Debug 模式、浏览器自动化、日志读取与运行验证',
    ],
  },
  {
    title: '审查、还原与隔离',
    icon: 'branch',
    summary: '每次自动改动都能审查、回退，并可放进独立 worktree。',
    href: '/features#review',
    proof: 'Checkpoint、HunkDiff、Worktree、typed IPC',
    items: [
      'Git Review / HunkDiff 逐块审查改动',
      '代码还原点与会话 Checkpoint 降低误改风险',
      'Git Worktree 会话隔离，支持远程连接工作流',
    ],
  },
  {
    title: '团队模式 A2A',
    icon: 'team',
    summary: 'Host Agent 可以按成员能力拆分任务，过程以事件流回放。',
    href: '/features#team',
    proof: 'Team Dispatch、member agent config、budget and timeout',
    items: [
      'Host Agent 调度 Member Agent 协作',
      '成员级模型、工具、Skills、MCP 和上下文',
      '群聊式过程、嵌套深度、预算、超时与审计',
    ],
  },
  {
    title: '双内核与渐进式 Skill',
    icon: 'runtime',
    summary: 'Claude SDK 与 Codex 共用同一会话治理层，Skill 按需读取上下文。',
    href: '/features#runtime',
    proof: 'Claude SDK Executor、Codex Executor、Skill Loader',
    items: [
      'Claude Agent SDK 适合工具调用和长流程',
      'Codex 适合代码补丁、命令执行和开发者 CLI',
      'Skill 按需读取 SKILL.md、references、scripts 与 assets',
    ],
  },
  {
    title: '内置工具 / Agent / 任务',
    icon: 'tools',
    summary: '搜索、调试、团队、画布、媒体和平台管理都作为内置工具暴露。',
    href: '/features#tools',
    proof: 'spark_search、spark_debug、spark_team、spark_canvas',
    items: [
      'spark_search、spark_debug、spark_team、spark_canvas 等内置 MCP',
      '平台管理 Agent、全栈编码 Agent、画布助手等开箱即用',
      '任务面板与定时任务承接长流程和周期性工作',
    ],
  },
  {
    title: '上下文可视化审计',
    icon: 'audit',
    summary: '让模型输入、工具调用、文件变更、费用和权限都能被复盘。',
    href: '/features#audit',
    proof: 'Usage Ledger、Audit Events、Rules、Hooks、Permissions',
    items: [
      '工具调用、文件变更、团队 dispatch 和用量账本可追踪',
      'Rules、Hooks、权限审批和审计事件本地优先',
      '项目、workspace、worktree、资产和会话统一组织',
    ],
  },
  {
    title: '无限画布内容创作',
    icon: 'canvas',
    summary: '把剧本、Prompt、素材、任务和产物组织成可追踪的画布节点。',
    href: '/canvas',
    proof: 'Canvas MCP Server、Canvas workspace、AI operation nodes',
    items: [
      '多画布、多节点、多素材，保留来源血缘',
      '文生图、图生图、图片编辑、多图合成、图生视频',
      '画布专属助手自动拆解、建节点、调度模型和回写结果',
    ],
  },
  {
    title: '资产中心与 3D 导演台',
    icon: 'film',
    summary: '角色、场景、镜头、构图和提示词库形成影视资产生产线。',
    href: '/canvas#film',
    proof: 'Film Asset Center、Shot Director、Prompt Library',
    items: [
      '剧本、角色、场景、道具、特效、提示词库统一管理',
      '3D 导演台配置相机、角色、站位、面向和画幅',
      '电影语言 Prompt Library 支持镜头、光圈、运镜、色彩和质感',
    ],
  },
  {
    title: '多媒体 Provider 生态',
    icon: 'provider',
    summary: '用 manifest 描述模型能力，统一文本、图片、视频和语音适配。',
    href: '/architecture#providers',
    proof: 'Media Runtime、model catalog、OpenAI-compatible adapters',
    items: [
      '文本、多模态、图片、语音、视频模型统一配置',
      'Provider manifest 描述模型能力与参数',
      '支持 OpenAI-compatible、xAI、APIMart、Kling、Volcengine 等适配方向',
    ],
  },
]

export const codeEvidence = [
  'Electron Main + React Renderer + typed IPC + window.spark preload 负责桌面边界',
  'Agent Runtime 汇聚 session、provider、MCP、team dispatch、permission、usage、rules、hooks 与 memory',
  '开发闭环覆盖 terminal、worktree、checkpoint、Git Review、debug mode 和 browser automation',
  'Media Runtime 包含 router、model catalog、artifacts 与 OpenAI-compatible / xAI / APIMart / template adapters',
  'Storage 通过 SQLite repositories 管理 session、team、canvas、skill、memory、provider、permission 和 usage data',
]
