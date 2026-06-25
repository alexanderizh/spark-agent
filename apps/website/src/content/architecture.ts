export const architectureLayers = [
  {
    name: '统一桌面入口',
    detail: 'React 19 Renderer 承载侧边聊天、任务面板、终端、Git Review、无限画布、资产中心和设置。',
  },
  {
    name: 'Typed IPC / Preload',
    detail: '通过类型化 IPC 暴露 window.spark，将 UI 请求安全送到 Electron Main。',
  },
  {
    name: 'Electron Main 服务层',
    detail: '窗口、数据库、文件协议、PTY 终端、浏览器自动化、远程连接和系统服务编排。',
  },
  {
    name: 'Agent Runtime 双内核',
    detail: 'Claude Agent SDK 与 Codex Executor 共享会话、Provider、MCP、Skill、权限、用量和事件协议。',
  },
  {
    name: '开发治理闭环',
    detail: 'Worktree、Checkpoint、HunkDiff、Debug、任务面板、定时任务和上下文可视化审计。',
  },
  {
    name: '创作与媒体运行时',
    detail: 'Canvas MCP、Media Runtime、资产中心、3D 导演台和多模型图片/视频/语音适配器。',
  },
  {
    name: '本地优先数据层',
    detail: 'SQLite repositories、workspace/worktree 文件、系统 keychain、资产文件与审计事件。',
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
