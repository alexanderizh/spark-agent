import { Icons } from '../Icons'

export const SUB_APP_ICON_OPTIONS = [
  { value: null, label: '默认应用', icon: Icons.AppWindow },
  { value: 'builtin:list-todo', label: '待办清单', icon: Icons.ListTodo },
  { value: 'builtin:book', label: '阅读记录', icon: Icons.Book },
  { value: 'builtin:calendar', label: '日历计划', icon: Icons.Calendar },
  { value: 'builtin:database', label: '数据工具', icon: Icons.Database },
  { value: 'builtin:agent', label: 'Agent 助手', icon: Icons.Bot },
  { value: 'builtin:canvas', label: '画布工具', icon: Icons.Canvas },
  { value: 'builtin:folder', label: '文件工具', icon: Icons.Folder },
  { value: 'builtin:globe', label: '网页工具', icon: Icons.Globe },
  { value: '📝', label: '便签', icon: null },
  { value: '📊', label: '统计', icon: null },
  { value: '⭐', label: '收藏', icon: null },
] as const
