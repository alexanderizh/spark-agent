export const docSections = [
  {
    title: '快速开始',
    steps: [
      '下载桌面应用',
      '配置 Provider 或本地 CLI',
      '创建第一个 Agent',
      '打开 workspace 并发送第一个代码或创作任务',
    ],
  },
  {
    title: '代码开发指南',
    steps: ['打开项目 workspace', '启用 Git Worktree 隔离', '使用内置终端', '通过 Git Review 审查补丁'],
  },
  {
    title: '团队 Agent 指南',
    steps: ['创建 Host Agent', '添加成员 Agent', '配置成员模型与工具', '查看群聊式事件流和预算'],
  },
  {
    title: '无限画布指南',
    steps: [
      '新建画布与添加节点',
      '使用 AI 面板生成内容',
      '管理 Film Asset Center',
      '串联剧本、角色、镜头、分镜和任务',
    ],
  },
  {
    title: '内容与媒体生产',
    steps: ['写文档 / PRD / 教程', '生成 PPT 大纲', '做网页内容', '批量处理文件与素材'],
  },
  {
    title: '生态配置',
    steps: ['添加 Provider', '添加 MCP Server', '安装或导入 Skill', '配置 Rules / Hooks / 权限'],
  },
]

export const docEntryLinks = [
  { title: '桌面端开发指南', href: 'desktopGuide', detail: 'Renderer、Main、IPC、服务层和本地数据。' },
  { title: 'Agent 工作流', href: 'agentsWorkflows', detail: '单 Agent、团队 Agent、工具调用和上下文组织。' },
  { title: '团队模式', href: 'teamMode', detail: 'Host / Member 调度、事件流、预算和超时。' },
  { title: '无限画布 MVP', href: 'canvasMvp', detail: '画布节点、资产中心、影视创作和任务队列。' },
  { title: '多媒体 Provider', href: 'mediaProviders', detail: '图片、视频、语音模型能力和参数映射。' },
  { title: '联网搜索', href: 'webSearch', detail: '内置搜索工具、抓取、降级和审计。' },
]
