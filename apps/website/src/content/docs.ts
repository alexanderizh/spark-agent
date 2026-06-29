export const docSections = [
  {
    title: '快速开始',
    steps: [
      '下载适合你系统的安装包并完成安装',
      '首次启动后接入常用模型服务或本地模型',
      '选择默认模型、执行内核和项目 workspace',
      '创建第一个 Agent，或直接在主页发送代码/创作任务',
    ],
  },
  {
    title: '代码开发指南',
    steps: [
      '打开项目 workspace，选择分支和执行内核',
      '启用 Git Worktree 隔离，避免改动污染主分支',
      '在侧边对话里描述目标，用内置终端运行验证',
      '逐块审查 AI 改动，确认后再提交补丁',
    ],
  },
  {
    title: '团队 Agent 指南',
    steps: [
      '创建主 Agent 并定义它负责协调的任务范围',
      '添加成员 Agent，配置各自模型、工具和 Skills',
      '设置嵌套深度、预算与超时上限',
      '在事件流中观察任务分派、执行、审查和汇总',
    ],
  },
  {
    title: '无限画布指南',
    steps: [
      '新建画布并添加文本、图片、Prompt、任务等节点',
      '使用 AI 面板在画布上下文内拆解任务并创建节点',
      '在资产中心管理角色、场景、镜头和生成结果',
      '串联剧本、角色、镜头、分镜与生成任务，保留血缘',
    ],
  },
  {
    title: '内容与媒体生产',
    steps: [
      '撰写文档、PRD 或教程，并导出 Markdown / DOCX',
      '生成演示大纲、幻灯片和可放映页面',
      '制作网页内容、海报和数据可视化页面',
      '批量处理文件与素材，产物沉淀到资产中心',
    ],
  },
  {
    title: '生态配置',
    steps: [
      '添加 Provider，并声明可用模型能力',
      '添加 MCP Server，或安装/导入 Skill',
      '配置 Rules / Hooks / 权限审批',
      '开启用量账本与审计事件用于复盘',
    ],
  },
  {
    title: '权限与治理',
    steps: [
      '为高风险操作（删除、联网、写文件）配置审批',
      '通过 Rules 约束 Agent 行为边界',
      '用 Hooks 在工具调用前后插入自定义逻辑',
      '在审计面板复盘工具调用、文件变更和模型费用',
    ],
  },
]

export const docEntryLinks = [
  { title: '桌面端开发指南', href: 'desktopGuide', detail: 'Renderer、Main、IPC、服务层和本地数据。' },
  { title: 'Agent 工作流', href: 'agentsWorkflows', detail: '单 Agent、团队 Agent、工具调用和上下文组织。' },
  { title: '团队模式', href: 'teamMode', detail: 'Host / Member 调度、事件流、预算和超时。' },
  { title: '无限画布 MVP', href: 'canvasMvp', detail: '画布节点、资产中心、影视创作和任务队列。' },
  { title: '多媒体 Provider', href: 'mediaProviders', detail: '图片、视频、语音模型能力和参数映射。' },
  { title: '图片生成 Provider', href: 'imageProviders', detail: '图片生成模型适配与能力边界。' },
  { title: '联网搜索', href: 'webSearch', detail: '内置搜索工具、抓取、降级和审计。' },
  { title: '浏览器自动化', href: 'browserAutomation', detail: 'Playwright 驱动的网页操作与数据采集。' },
  { title: '远程连接', href: 'remoteConnections', detail: '远程工作机、SSH 与 worktree 协作。' },
  { title: '自动更新', href: 'autoUpdate', detail: '基于 GitHub Release 的桌面端自动更新。' },
  { title: '可安装 Skills', href: 'installableSkills', detail: 'Skill 安装、加载与按需读取上下文。' },
]
