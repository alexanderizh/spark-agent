import type { ReactNode } from 'react'
import {
  BarChart3,
  Bell,
  Bot,
  Book,
  Calculator,
  Calendar,
  Camera,
  Clapperboard,
  Clock,
  CloudSun,
  Code,
  CookingPot,
  Database,
  Dumbbell,
  FileText,
  Flame,
  Folder,
  Gamepad2,
  GitBranch,
  Globe,
  GraduationCap,
  HeartPulse,
  Image as ImageIcon,
  KanbanSquare,
  KeyRound,
  Languages,
  Lightbulb,
  ListTodo,
  Mail,
  MessageCircle,
  Music,
  NotebookPen,
  Palette,
  Plane,
  Presentation,
  Puzzle,
  Search,
  ShoppingBag,
  Star,
  StickyNote,
  Table2,
  Terminal,
  Timer,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react'
import { Icons } from '../Icons'

export interface SubAppIconShape {
  size?: number
  className?: string
  strokeWidth?: number
}

/** 子应用图标组件的统一签名（自绘 Icons 与 lucide-react 组件均满足）。 */
export type SubAppIconComponent = (props: SubAppIconShape) => ReactNode

export interface SubAppIconEntry {
  /** `builtin:` 前缀后的图标标识（kebab-case）。 */
  key: string
  /** 图标选择器里展示的中文名。 */
  label: string
  Icon: SubAppIconComponent
}

/**
 * 受控子应用图标注册表 —— 应用管理页选择器与 SubAppIcon 渲染共用的唯一事实源。
 *
 * 注意：spark_app_* 工具提示词（packages/agent-runtime/src/tools/sub-app-mcp-server.mjs）
 * 按名称同步维护同一份 key 列表，新增/改名时两处必须一起改。
 * 不再提供 Emoji 图标：Emoji 仅作为历史数据在渲染层兼容。
 */
export const SUB_APP_ICONS: readonly SubAppIconEntry[] = [
  { key: 'list-todo', label: '待办清单', Icon: ListTodo },
  { key: 'book', label: '阅读记录', Icon: Book },
  { key: 'calendar', label: '日历计划', Icon: Calendar },
  { key: 'sticky-note', label: '便签速记', Icon: StickyNote },
  { key: 'note', label: '笔记本', Icon: NotebookPen },
  { key: 'kanban', label: '看板协作', Icon: KanbanSquare },
  { key: 'table', label: '表格数据', Icon: Table2 },
  { key: 'presentation', label: '演示文稿', Icon: Presentation },
  { key: 'file-text', label: '文档处理', Icon: FileText },
  { key: 'search', label: '聚合检索', Icon: Search },
  { key: 'translate', label: '翻译助手', Icon: Languages },
  { key: 'study', label: '学习进修', Icon: GraduationCap },
  { key: 'lightbulb', label: '灵感收集', Icon: Lightbulb },
  { key: 'timer', label: '专注计时', Icon: Timer },
  { key: 'clock', label: '时间管理', Icon: Clock },
  { key: 'bell', label: '提醒通知', Icon: Bell },
  { key: 'chat', label: '聊天沟通', Icon: MessageCircle },
  { key: 'mail', label: '邮件助手', Icon: Mail },
  { key: 'agent', label: 'Agent 助手', Icon: Bot },
  { key: 'code', label: '代码工具', Icon: Code },
  { key: 'terminal', label: '终端工具', Icon: Terminal },
  { key: 'git', label: '代码仓库', Icon: GitBranch },
  { key: 'workflow', label: '自动化流', Icon: Workflow },
  { key: 'puzzle', label: '插件扩展', Icon: Puzzle },
  { key: 'key', label: '密码保险箱', Icon: KeyRound },
  { key: 'calculator', label: '计算器', Icon: Calculator },
  { key: 'database', label: '数据工具', Icon: Database },
  { key: 'canvas', label: '画布工具', Icon: Icons.Canvas },
  { key: 'palette', label: '设计绘图', Icon: Palette },
  { key: 'image', label: '图片工具', Icon: ImageIcon },
  { key: 'video', label: '视频工具', Icon: Clapperboard },
  { key: 'music', label: '音乐音频', Icon: Music },
  { key: 'camera', label: '相机拍照', Icon: Camera },
  { key: 'globe', label: '网页工具', Icon: Globe },
  { key: 'folder', label: '文件工具', Icon: Folder },
  { key: 'weather', label: '天气空气', Icon: CloudSun },
  { key: 'health', label: '健康心率', Icon: HeartPulse },
  { key: 'fitness', label: '健身打卡', Icon: Dumbbell },
  { key: 'habit', label: '习惯养成', Icon: Flame },
  { key: 'wallet', label: '记账理财', Icon: Wallet },
  { key: 'shopping', label: '购物清单', Icon: ShoppingBag },
  { key: 'cooking', label: '食谱烹饪', Icon: CookingPot },
  { key: 'travel', label: '旅行出行', Icon: Plane },
  { key: 'game', label: '游戏娱乐', Icon: Gamepad2 },
  { key: 'star', label: '收藏夹', Icon: Star },
  { key: 'users', label: '团队协作', Icon: Users },
  { key: 'chart', label: '统计图表', Icon: BarChart3 },
]

export interface SubAppIconOption {
  /** 写入子应用 manifest 的 icon 值；null 表示未设置（默认应用图标）。 */
  value: string | null
  label: string
  icon: SubAppIconComponent
}

/** 应用管理页图标选择器的选项列表（默认项 + 全部受控图标）。 */
export const SUB_APP_ICON_OPTIONS: readonly SubAppIconOption[] = [
  { value: null, label: '默认应用', icon: Icons.AppWindow },
  ...SUB_APP_ICONS.map(({ key, label, Icon }) => ({
    value: `builtin:${key}`,
    label,
    icon: Icon,
  })),
]
