import type { AccountSyncCategory } from '@spark/protocol'

/** 同步类别的展示元信息，设置页与冲突面板共用 */
export const CATEGORY_META: Record<AccountSyncCategory, { label: string; description: string }> = {
  customCommands: {
    label: '自定义命令',
    description: '同步命令名称、说明、提示词和脚本；含凭据或本机路径的整条跳过。',
  },
  prompts: {
    label: '各级提示词',
    description: '同步用户、项目与会话提示词；系统规则只同步启用状态指纹。',
  },
  memory: {
    label: '记忆',
    description: '同步用户、项目和助手记忆；目标项目不可用时保留待应用状态。',
  },
  assistants: {
    label: '助手与团队',
    description: '同步结构与提示词，不包含模型、渠道、运行引擎、MCP、Hooks 或凭据。',
  },
  workflows: {
    label: '工作流',
    description: '同步安全的工作流定义；含模型、Provider、环境变量或请求头的工作流跳过。',
  },
  appearance: {
    label: '外观设置',
    description: '同步主题、主色、密度、字体、字号、缩放和聊天显示偏好。',
  },
  promptLibrary: {
    label: '提示词库',
    description: '同步画布提示词库条目；封面图片压缩后同步，远程图片 URL 原样保留。',
  },
}
