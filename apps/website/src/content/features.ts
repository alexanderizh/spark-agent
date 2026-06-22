export const featureGroups = [
  {
    title: '内容创作工作台',
    items: ['写文章、方案、PRD 与教程', '做 PPT 大纲与网页内容', '处理文件、素材和项目上下文'],
  },
  {
    title: '代码开发',
    items: [
      'Codex / Claude 双执行路径',
      '内置终端、Git Worktree 与检查点',
      '调试模式、文件审阅与浏览器自动化',
    ],
  },
  {
    title: '影视无限画布',
    items: [
      '剧本拆解、镜头规划与分镜表',
      '角色 / 场景 / 道具资产中心',
      'Prompt Library、任务队列与资产回写',
    ],
  },
  {
    title: '多媒体生成',
    items: [
      '文生图、图生图与图片编辑适配',
      '可扩展到视频、音频等多模态任务',
      'Provider manifest 驱动模型能力',
    ],
  },
  {
    title: '多 Agent 团队',
    items: [
      'Host Agent 调度 Member Agent',
      '成员级模型、工具、Skills 和 MCP',
      '群聊式过程、预算、超时与审计',
    ],
  },
  {
    title: '本地治理生态',
    items: [
      'MCP Server、Skills 与 Provider 扩展',
      '权限审批、用量账本、Rules 和 Hooks',
      '本地记忆、SQLite 与系统凭据存储',
    ],
  },
]

export const codeEvidence = [
  'Electron Main + React Renderer + typed IPC + window.spark preload',
  'Agent Runtime: session, provider, MCP, team dispatch, permission, usage, rules, hooks, memory',
  'Media Runtime: router, model catalog, artifacts, OpenAI-compatible / xAI / APIMart / template adapters',
  'Storage: SQLite repositories for session, team, canvas, skill, memory, provider, permission and usage data',
]
