/**
 * ProviderLogo — 统一渲染供应商真实 SVG logo，失败时回退到 emoji + vendor 颜色
 *
 * 设计要点
 * ─────────
 * - 使用 Vite `import.meta.glob` 在构建期把所有 providers/*.svg 全部注册为静态资源，
 *   运行时按 vendor.logoPath 字符串（来自 protocol 的 VENDOR_CATALOG）查表拿到 URL。
 * - 加载失败 / 路径缺失时，渲染 emoji 文字并使用 vendor 颜色作为底色，确保 C 端
 *   视觉不出现"破图"。
 * - 尺寸按 C 端标准提供 sm/md/lg/xl 四档，外加自定义像素。
 * - shape 默认 square（与现有 provider-card 一致），可选 rounded。
 */
import { useState, type CSSProperties } from 'react'
import type { VendorMeta } from '@spark/protocol'

/**
 * Vite 在 build 时把这段 glob 展开成 `{ '../assets/providers/openai.svg': 'data-url', ... }`。
 * 路径相对于本文件（components/ProviderLogo.tsx）—— 从 components/ 出发上溯两层到 renderer/，
 * 再进 assets/providers/。Vite 用 eager:true 把所有 SVG 直接打进 bundle，不需要运行时动态 import。
 */
const svgModules = import.meta.glob<string>(
  '../../assets/providers/*.svg',
  { eager: true, query: '?url', import: 'default' },
)

/** 从 logoPath（如 "providers/openai.svg"）解析为 import URL */
function resolveLogo(logoPath: string | undefined): string | null {
  if (!logoPath) return null
  // logoPath 不含 ../../assets/ 前缀，需要补齐
  const key = `../../assets/providers/${logoPath.replace(/^providers\//, '')}`
  return svgModules[key] ?? null
}

type LogoSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE_PX: Record<LogoSize, number> = {
  sm: 20,
  md: 28,
  lg: 36,
  xl: 48,
}

type ProviderLogoProps = {
  vendor: VendorMeta | undefined | null
  /** 预设档位（sm/md/lg/xl）或自定义像素 */
  size?: LogoSize | number
  /** 是否带圆角（默认 square 与已有 provider-card 一致） */
  shape?: 'square' | 'rounded' | 'circle'
  /** 额外的 className（用于覆盖 padding / border） */
  className?: string
  /** 当 vendor 不存在 / logo 缺失 / 加载失败时显示的文字 */
  fallbackText?: string
  /** 强制使用 fallback（调试/截图） */
  forceFallback?: boolean
  style?: CSSProperties
  title?: string
}

export function ProviderLogo({
  vendor,
  size = 'md',
  shape = 'square',
  className = '',
  fallbackText,
  forceFallback = false,
  style,
  title,
}: ProviderLogoProps) {
  const px = typeof size === 'number' ? size : SIZE_PX[size]
  const [errored, setErrored] = useState(false)
  const logoUrl = forceFallback ? null : resolveLogo(vendor?.logoPath)
  const showImage = !!logoUrl && !errored
  const radius =
    shape === 'circle' ? '50%' : shape === 'rounded' ? 'var(--r-sm)' : 'var(--r-md)'

  // 取 emoji / 文字作为 fallback
  const fallback = fallbackText ?? vendor?.emoji ?? '?'

  return (
    <span
      className={`provider-logo provider-logo-${shape} ${className}`}
      style={{
        width: px,
        height: px,
        borderRadius: radius,
        background: vendor?.color ?? 'var(--bg-soft)',
        color: '#fff',
        ...style,
      }}
      title={title ?? vendor?.name}
      aria-label={vendor?.name}
    >
      {showImage ? (
        <img
          src={logoUrl}
          alt={vendor?.name ?? ''}
          className="provider-logo-img"
          onError={() => setErrored(true)}
          draggable={false}
        />
      ) : (
        <span className="provider-logo-fallback">{fallback}</span>
      )}
    </span>
  )
}

export default ProviderLogo
