export const architectureLayers = [
  {
    name: 'Renderer UI',
    detail: 'React 19 桌面界面、无限画布、团队消息、终端、设置与 Skill Store。',
  },
  {
    name: 'Typed IPC / Preload',
    detail: '通过类型化 IPC 暴露 window.spark，将 UI 请求送到 Electron Main。',
  },
  { name: 'Electron Main', detail: '窗口、数据库、文件协议、终端、浏览器自动化与服务编排。' },
  {
    name: 'Agent Runtime',
    detail: 'Claude SDK、Codex CLI/OpenAI、Session、Provider、MCP、Team Dispatch、Media Runtime。',
  },
  {
    name: 'Governance',
    detail: 'Permission、Usage Ledger、Rules Engine、Hooks、Memory 与审计事件。',
  },
  {
    name: 'Local Data',
    detail: 'SQLite repositories、本地 workspace / worktree、系统 keychain 与本地文件资产。',
  },
]

export const runtimeModules = [
  'Session Service',
  'Provider Service',
  'MCP Client / Server',
  'Permission Service',
  'Usage Ledger',
  'Rules Engine',
  'Memory Service',
  'Team Dispatch',
  'Canvas MCP Server',
  'Media Task Runtime',
]
