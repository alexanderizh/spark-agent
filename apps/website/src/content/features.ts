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
    title: '代码开发与问题定位',
    icon: 'code',
    summary: '让 Agent 在项目上下文里读代码、改代码、运行命令并解释结果。',
    href: '/features#coding',
    proof: '适合修复缺陷、补测试、改接口、排查前后端问题',
    items: [
      '在同一窗口查看对话、文件、终端、任务状态和改动差异',
      '按任务选择 Claude SDK 或 Codex 执行路径',
      '结合日志、浏览器自动化和运行结果定位真实问题',
    ],
  },
  {
    title: '可审查的自动改动',
    icon: 'branch',
    summary: '让 AI 的每一步修改都有边界、有记录，也能被你逐块确认。',
    href: '/features#review',
    proof: '适合团队采用 AI 编码时控制风险',
    items: [
      '逐块查看、接受或撤回 AI 产生的代码改动',
      '用 Checkpoint 保留关键节点，误改时可以回退',
      '用 Git Worktree 隔离会话，避免污染当前分支',
    ],
  },
  {
    title: '多 Agent 团队协作',
    icon: 'team',
    summary: '让一个主 Agent 按能力分派任务，开发、审查、调研可以并行推进。',
    href: '/features#team',
    proof: '适合复杂任务、跨角色协作和可复盘执行',
    items: [
      '为成员 Agent 分别配置模型、工具、Skills、MCP 和上下文',
      '通过群聊式事件流观察分派、执行、审查和汇总',
      '设置预算、超时和嵌套深度，避免任务失控',
    ],
  },
  {
    title: '可扩展的 Agent 能力',
    icon: 'runtime',
    summary: '用 Skills、MCP 和双执行内核，把常用工作流沉淀成可复用能力。',
    href: '/features#runtime',
    proof: '适合把团队经验变成稳定流程',
    items: [
      'Claude Agent SDK 适合长流程、工具调用和协作任务',
      'Codex 适合代码补丁、命令执行和开发者 CLI 工作',
      'Skill 可携带说明、脚本和素材，按任务需要加载',
    ],
  },
  {
    title: '开箱即用的工具与任务面板',
    icon: 'tools',
    summary: '把搜索、调试、团队协作、画布和媒体生成做成可调用的工作台能力。',
    href: '/features#tools',
    proof: '适合日常开发、内容生产和周期性任务',
    items: [
      '内置搜索、调试、团队协作、画布和媒体相关工具',
      '平台管理、全栈编码、画布助手等 Agent 可直接使用',
      '任务面板承接长流程，定时任务适合周期性工作',
    ],
  },
  {
    title: '上下文、权限和费用可见',
    icon: 'audit',
    summary: '让模型用了什么上下文、调用了什么工具、产生了什么改动都看得见。',
    href: '/features#audit',
    proof: '适合重视安全、成本和合规的团队',
    items: [
      '追踪工具调用、文件变更、团队分派和模型用量',
      '通过规则、Hooks 和权限审批约束高风险操作',
      '按项目统一组织 workspace、worktree、资产和会话',
    ],
  },
  {
    title: '无限画布创作空间',
    icon: 'canvas',
    summary: '把剧本、参考图、Prompt、任务和生成结果放到一张可追踪的画布上。',
    href: '/canvas',
    proof: '适合影视分镜、营销物料、课程内容和多媒体项目',
    items: [
      '多画布、多节点、多素材管理，保留来源和派生关系',
      '支持文生图、图生图、图片编辑、多图合成和图生视频',
      '画布助手可拆解任务、创建节点、调用模型并回写结果',
    ],
  },
  {
    title: '影视资产中心与导演台',
    icon: 'film',
    summary: '把角色、场景、镜头、构图和提示词沉淀成可复用的制作资产。',
    href: '/canvas#film',
    proof: '适合从剧本策划推进到分镜和视频生成',
    items: [
      '集中管理剧本、角色、场景、道具、特效和提示词',
      '用 3D 导演台规划相机、站位、面向和画幅',
      '用电影语言提示词库统一镜头、光圈、运镜、色彩和质感',
    ],
  },
  {
    title: '多媒体模型统一接入',
    icon: 'provider',
    summary: '把文本、图片、视频和语音模型纳入同一套配置，让工作流按能力调用。',
    href: '/architecture#providers',
    proof: '适合同时使用多个模型服务商的团队',
    items: [
      '统一配置文本、多模态、图片、语音和视频模型',
      '用 Provider manifest 描述能力、参数和限制',
      '支持兼容协议、本地模型和多家图片/视频服务接入',
    ],
  },
]

export const codeEvidence = [
  '桌面端本地运行，敏感项目上下文优先留在你的机器和 workspace 中',
  'Agent Runtime 统一管理会话、模型、MCP、团队协作、权限、用量、规则和记忆',
  '开发闭环覆盖终端、worktree、checkpoint、改动审查、调试模式和浏览器自动化',
  '媒体运行时统一路由模型能力、任务产物和图片/视频/语音服务适配',
  '本地数据层管理会话、团队、画布、技能、记忆、服务商、权限和用量记录',
]
