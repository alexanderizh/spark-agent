import React from 'react'
import { Icons } from '../Icons'
import { SUB_APP_ICONS, type SubAppIconComponent, type SubAppIconShape } from './subAppIconOptions'

/** 与全局自绘图标体系一致的描边粗细（lucide-react 默认 2，这里统一为 1.6）。 */
const ICON_STROKE_WIDTH = 1.6

const DEFAULT_ICON: SubAppIconComponent = Icons.AppWindow

const BUILTIN_ICON_MAP: ReadonlyMap<string, SubAppIconComponent> = new Map<
  string,
  SubAppIconComponent
>([
  // 默认图标也注册为受控值，历史 "app/application/app-window" 文本可解析到它。
  ['app-window', DEFAULT_ICON],
  ...SUB_APP_ICONS.map(({ key, Icon }) => [key, Icon] as const),
])

/** 历史别名：旧版本写入的短名/同义词继续解析到现在的受控图标。 */
const LEGACY_ALIASES: Record<string, string> = {
  app: 'app-window',
  application: 'app-window',
  list: 'list-todo',
  todo: 'list-todo',
  tasks: 'list-todo',
  reading: 'book',
  data: 'database',
  assistant: 'agent',
  files: 'folder',
  web: 'globe',
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

function resolveBuiltinIcon(value: string): SubAppIconComponent | null {
  const key = normalizeBuiltinKey(value)
  if (key.length === 0) return null
  return BUILTIN_ICON_MAP.get(LEGACY_ALIASES[key] ?? key) ?? null
}

function renderIcon(
  Icon: SubAppIconComponent,
  size: number,
  className: string | undefined,
): React.ReactElement {
  // exactOptionalPropertyTypes：可选属性不能显式传 undefined，缺失时直接省略属性。
  if (className == null) {
    return <Icon size={size} strokeWidth={ICON_STROKE_WIDTH} />
  }
  return <Icon size={size} className={className} strokeWidth={ICON_STROKE_WIDTH} />
}

export interface SubAppIconProps {
  icon?: string | null | undefined
  size?: number
  className?: string
}

/**
 * 子应用图标的唯一渲染入口。
 *
 * 兼容历史数据：旧版本可能把任意说明文本写进 icon 字段；这类值不再直接
 * 渲染到窄菜单中，而是回退为统一的应用图标。新值只使用 builtin:* 受控图标；
 * 短 Emoji 仅为旧数据保留渲染兼容，选择器与工具提示词均已不再提供。
 */
export function SubAppIcon({ icon, size = 18, className }: SubAppIconProps): React.ReactElement {
  const value = icon?.trim() ?? ''
  const BuiltinIcon = value.length > 0 ? resolveBuiltinIcon(value) : null

  if (BuiltinIcon != null) {
    return renderIcon(BuiltinIcon, size, className)
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

  return renderIcon(DEFAULT_ICON, size, className)
}
