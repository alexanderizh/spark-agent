import React from 'react'
import { Icons } from '../Icons'

type IconRenderer = (props: { size: number; className?: string }) => React.ReactElement

const renderAppIcon: IconRenderer = ({ size, className }) =>
  className == null ? (
    <Icons.AppWindow size={size} />
  ) : (
    <Icons.AppWindow size={size} className={className} />
  )
const renderListIcon: IconRenderer = ({ size, className }) =>
  className == null ? (
    <Icons.ListTodo size={size} />
  ) : (
    <Icons.ListTodo size={size} className={className} />
  )
const renderBookIcon: IconRenderer = ({ size, className }) =>
  className == null ? <Icons.Book size={size} /> : <Icons.Book size={size} className={className} />
const renderCalendarIcon: IconRenderer = ({ size, className }) =>
  className == null ? (
    <Icons.Calendar size={size} />
  ) : (
    <Icons.Calendar size={size} className={className} />
  )
const renderDatabaseIcon: IconRenderer = ({ size, className }) =>
  className == null ? (
    <Icons.Database size={size} />
  ) : (
    <Icons.Database size={size} className={className} />
  )
const renderAgentIcon: IconRenderer = ({ size, className }) =>
  className == null ? <Icons.Bot size={size} /> : <Icons.Bot size={size} className={className} />
const renderCanvasIcon: IconRenderer = ({ size, className }) =>
  className == null ? (
    <Icons.Canvas size={size} />
  ) : (
    <Icons.Canvas size={size} className={className} />
  )
const renderFolderIcon: IconRenderer = ({ size, className }) =>
  className == null ? (
    <Icons.Folder size={size} />
  ) : (
    <Icons.Folder size={size} className={className} />
  )
const renderGlobeIcon: IconRenderer = ({ size, className }) =>
  className == null ? (
    <Icons.Globe size={size} />
  ) : (
    <Icons.Globe size={size} className={className} />
  )

const BUILTIN_ICONS: Record<string, IconRenderer> = {
  app: renderAppIcon,
  application: renderAppIcon,
  'app-window': renderAppIcon,
  'list-todo': renderListIcon,
  list: renderListIcon,
  todo: renderListIcon,
  tasks: renderListIcon,
  book: renderBookIcon,
  reading: renderBookIcon,
  calendar: renderCalendarIcon,
  database: renderDatabaseIcon,
  data: renderDatabaseIcon,
  agent: renderAgentIcon,
  assistant: renderAgentIcon,
  canvas: renderCanvasIcon,
  folder: renderFolderIcon,
  files: renderFolderIcon,
  globe: renderGlobeIcon,
  web: renderGlobeIcon,
}

function normalizeBuiltinKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^builtin:/, '')
    .replace(/[ _]+/g, '-')
}

function isEmojiLike(value: string): boolean {
  // 图标字段不是任意文本字段：仅保留短 Emoji，旧的 "to do" 等文本回退到默认图标。
  return value.length <= 8 && /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(value)
}

function resolveBuiltinIcon(value: string): IconRenderer | null {
  return BUILTIN_ICONS[normalizeBuiltinKey(value)] ?? null
}

export interface SubAppIconProps {
  icon?: string | null
  size?: number
  className?: string
}

/**
 * 子应用图标的唯一渲染入口。
 *
 * 兼容历史数据：旧版本可能把任意说明文本写进 icon 字段；这类值不再直接
 * 渲染到窄菜单中，而是回退为统一的应用图标。新值支持 builtin:* 和短 Emoji。
 */
export function SubAppIcon({ icon, size = 18, className }: SubAppIconProps): React.ReactElement {
  const value = icon?.trim() ?? ''
  const BuiltinIcon = value.length > 0 ? resolveBuiltinIcon(value) : renderAppIcon

  if (BuiltinIcon != null) {
    return BuiltinIcon(className == null ? { size } : { size, className })
  }

  if (isEmojiLike(value)) {
    return (
      <span
        className={className}
        style={{ fontSize: size, lineHeight: 1, whiteSpace: 'nowrap' }}
        role="img"
      >
        {value}
      </span>
    )
  }

  return className == null ? (
    <Icons.AppWindow size={size} />
  ) : (
    <Icons.AppWindow size={size} className={className} />
  )
}
