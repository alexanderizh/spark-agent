import { useId } from 'react'

// Spark Agent 应用标识 —— 与桌面端图标（apps/desktop/resources）同源。
// 两个互锁圆环构成无限符号：左环深石墨色，右环品牌彩虹渐变，
// 置于暖米色圆角底上。SVG 路径与桌面端 taskbar 图标一致，保证跨端一致。
export function Logo({
  size = 32,
  showBackground = true,
  title = 'Spark Agent',
  className,
}: {
  size?: number
  showBackground?: boolean
  title?: string
  className?: string
}) {
  // 每个实例独立的渐变 id，避免同一页内多个 Logo 出现重复 id。
  const uid = useId()
  const gradId = `${uid}-grad`
  const bgId = `${uid}-bg`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      role="img"
      aria-label={title}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={gradId} x1="0.05" y1="0.2" x2="0.95" y2="0.85">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="33%" stopColor="#8B5CF6" />
          <stop offset="66%" stopColor="#EC4899" />
          <stop offset="100%" stopColor="#F97316" />
        </linearGradient>
        <radialGradient id={bgId} cx="0.5" cy="0.42" r="0.85">
          <stop offset="0%" stopColor="#F8F4EA" />
          <stop offset="100%" stopColor="#EFE7D5" />
        </radialGradient>
      </defs>
      {showBackground && <rect x="0" y="0" width="256" height="256" rx="55" fill={`url(#${bgId})`} />}
      <g fillRule="evenodd">
        <path
          d="M 93 81 a 50 50 0 1 0 0.001 0 Z M 93 98.5 a 32.5 32.5 0 1 1 -0.001 0 Z"
          fill="#181820"
        />
        <path
          d="M 163 81 a 50 50 0 1 0 0.001 0 Z M 163 98.5 a 32.5 32.5 0 1 1 -0.001 0 Z"
          fill={`url(#${gradId})`}
        />
      </g>
      <ellipse cx="128" cy="128" rx="18" ry="45" fill="#3A2E1E" opacity="0.3" />
    </svg>
  )
}
