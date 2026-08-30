// GitHub 图标 —— 统一使用 @lobehub/icons 的官方 Mono 图标（fill=currentColor，跟随文字色）。
// 保持 lucide 风格的 props 习惯（size / className / aria-hidden），调用点无需改动。
import { Github } from '@lobehub/icons'

export function GithubIcon({
  size = 16,
  className,
  'aria-hidden': ariaHidden = true,
}: {
  size?: number
  className?: string
  'aria-hidden'?: boolean
}) {
  return (
    <Github
      size={size}
      className={className}
      aria-hidden={ariaHidden}
      role={ariaHidden ? undefined : 'img'}
      aria-label={ariaHidden ? undefined : 'GitHub'}
    />
  )
}
