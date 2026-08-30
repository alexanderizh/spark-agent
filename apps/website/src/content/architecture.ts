export const architectureLayers = [
  {
    name: '统一桌面工作台',
    detail: '把对话、任务面板、终端、改动审查、无限画布、资产中心和设置放在同一个桌面入口。',
  },
  {
    name: '安全的桌面边界',
    detail: '通过受控的 IPC 与 preload 通道连接界面和系统能力，减少不必要的权限暴露。',
  },
  {
    name: '本机服务编排',
    detail: '负责窗口、数据库、文件协议、终端、浏览器自动化、远程连接和系统服务。',
  },
  {
    name: 'Agent Runtime',
    detail: '统一管理 Claude Agent SDK、Codex、会话、Provider、MCP、Skill、权限、用量和事件。',
  },
  {
    name: '可审查的执行过程',
    detail: '用 worktree、checkpoint、改动审查、调试、任务面板和审计记录约束自动化风险。',
  },
  {
    name: '创作与媒体运行时',
    detail: '连接无限画布、媒体任务、资产中心、3D 导演台和图片/视频/语音模型。',
  },
  {
    name: '本地优先数据层',
    detail: '会话、资产、凭据、workspace 文件和审计记录优先由本机环境管理。',
  },
]

export const runtimeModules = [
  'Claude SDK Executor',
  'Codex Executor',
  'Session Service',
  'Provider Service',
  'MCP Client / Server',
  'Skill Loader',
  'Terminal Service',
  'Git Worktree',
  'Checkpoint',
  'Git Review',
  'Debug Mode',
  'Team Dispatch',
  'Scheduler',
  'Remote Connection',
  'Canvas MCP Server',
  'Media Task Runtime',
  'Usage Ledger',
  'Audit Events',
]

export const architectureLinks = [
  ['桌面端开发指南', '/docs'],
  ['运行时治理', '/features#audit'],
  ['Provider 与 MCP', '/docs'],
  ['无限画布', '/canvas'],
]
