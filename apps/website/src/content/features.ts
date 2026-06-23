export const featureGroups = [
  {
    title: '代码开发与调试',
    items: [
      '双内核代码 Agent：Claude SDK / Codex 可切换',
      '侧边聊天、内置终端、文件目录和任务面板统一',
      'Debug 模式、浏览器自动化、日志读取与运行验证',
    ],
  },
  {
    title: '审查、还原与隔离',
    items: [
      'Git Review / HunkDiff 逐块审查改动',
      '代码还原点与会话 Checkpoint 降低误改风险',
      'Git Worktree 会话隔离，支持远程连接工作流',
    ],
  },
  {
    title: '团队模式 A2A',
    items: [
      'Host Agent 调度 Member Agent 协作',
      '成员级模型、工具、Skills、MCP 和上下文',
      '群聊式过程、嵌套深度、预算、超时与审计',
    ],
  },
  {
    title: '双内核与渐进式 Skill',
    items: [
      'Claude Agent SDK 适合工具调用和长流程',
      'Codex 适合代码补丁、命令执行和开发者 CLI',
      'Skill 按需读取 SKILL.md、references、scripts 与 assets',
    ],
  },
  {
    title: '内置工具 / Agent / 任务',
    items: [
      'spark_search、spark_debug、spark_team、spark_canvas 等内置 MCP',
      '平台管理 Agent、全栈编码 Agent、画布助手等开箱即用',
      '任务面板与定时任务承接长流程和周期性工作',
    ],
  },
  {
    title: '上下文可视化审计',
    items: [
      '工具调用、文件变更、团队 dispatch 和用量账本可追踪',
      'Rules、Hooks、权限审批和审计事件本地优先',
      '项目、workspace、worktree、资产和会话统一组织',
    ],
  },
  {
    title: '无限画布内容创作',
    items: [
      '多画布、多节点、多素材，保留来源血缘',
      '文生图、图生图、图片编辑、多图合成、图生视频',
      '画布专属助手自动拆解、建节点、调度模型和回写结果',
    ],
  },
  {
    title: '资产中心与 3D 导演台',
    items: [
      '剧本、角色、场景、道具、特效、提示词库统一管理',
      '3D 导演台配置相机、角色、站位、面向和画幅',
      '电影语言 Prompt Library 支持镜头、光圈、运镜、色彩和质感',
    ],
  },
  {
    title: '多媒体 Provider 生态',
    items: [
      '文本、多模态、图片、语音、视频模型统一配置',
      'Provider manifest 描述模型能力与参数',
      '支持 OpenAI-compatible、xAI、APIMart、Kling、Volcengine 等适配方向',
    ],
  },
]

export const codeEvidence = [
  'Electron Main + React Renderer + typed IPC + window.spark preload',
  'Agent Runtime: session, provider, MCP, team dispatch, permission, usage, rules, hooks, memory',
  'Developer loop: terminal, worktree, checkpoint, Git Review, debug mode, browser automation',
  'Media Runtime: router, model catalog, artifacts, OpenAI-compatible / xAI / APIMart / template adapters',
  'Storage: SQLite repositories for session, team, canvas, skill, memory, provider, permission and usage data',
]
