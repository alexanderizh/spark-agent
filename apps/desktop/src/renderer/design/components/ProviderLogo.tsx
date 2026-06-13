/**
 * ProviderLogo — 统一渲染供应商 logo（@lobehub/icons Avatar），失败时回退到本地图片或 emoji
 */
import {
  Alibaba,
  Anthropic,
  Baidu,
  Bailian,
  Claude,
  ClaudeCode,
  Codex,
  DeepSeek,
  Github,
  Google,
  HuaweiCloud,
  IFlyTekCloud,
  Infinigence,
  Kling,
  Minimax,
  Moonshot,
  NewAPI,
  Ollama,
  OpenAI,
  OpenRouter,
  Qwen,
  SiliconCloud,
  StateCloud,
  TencentCloud,
  Trae,
  Volcengine,
  XiaomiMiMo,
  Zhipu,
} from '@lobehub/icons'
import { useState, type CSSProperties, type FC } from 'react'
import type { VendorMeta } from '@spark/protocol'

// ─── 本地资源回退 ───

const assetModules = import.meta.glob<string>(
  '../../assets/providers/*.{svg,png}',
  { eager: true, query: '?url', import: 'default' },
)

function resolveLocalLogo(logoPath: string | undefined): string | null {
  if (!logoPath) return null
  const key = `../../assets/providers/${logoPath.replace(/^providers\//, '')}`
  return assetModules[key] ?? null
}

// ─── Vendor ID → Lobehub Avatar 组件映射（彩色版本） ───

type AvatarFC = FC<{ size: number; shape?: 'circle' | 'square' }>

const VENDOR_AVATAR_MAP: Record<string, AvatarFC> = {
  openai: OpenAI.Avatar as AvatarFC,
  anthropic: Anthropic.Avatar as AvatarFC,
  claude: Claude.Avatar as AvatarFC,
  // 内置本地 CLI provider（id 与 provider profile id 对齐）
  'local-claude-cli': ClaudeCode.Avatar as AvatarFC,
  'local-codex-cli': Codex.Avatar as AvatarFC,
  'google-gemini': Google.Avatar as AvatarFC,
  'tencent-coding-plan': TencentCloud.Avatar as AvatarFC,
  'aliyun-bailian-coding-plan': Bailian.Avatar as AvatarFC,
  'zhipu-glm-coding-plan': Zhipu.Avatar as AvatarFC,
  'qwen-standard': Qwen.Avatar as AvatarFC,
  'deepseek-api': DeepSeek.Avatar as AvatarFC,
  minimax: Minimax.Avatar as AvatarFC,
  kimi: Moonshot.Avatar as AvatarFC,
  siliconflow: SiliconCloud.Avatar as AvatarFC,
  openrouter: OpenRouter.Avatar as AvatarFC,
  ollama: Ollama.Avatar as AvatarFC,
  xfyun: IFlyTekCloud.Avatar as AvatarFC,
  ctyun: StateCloud.Avatar as AvatarFC,
  baidu: Baidu.Avatar as AvatarFC,
  volcengine: Volcengine.Avatar as AvatarFC,
  huaweicloud: HuaweiCloud.Avatar as AvatarFC,
  'infini-ai': Infinigence.Avatar as AvatarFC,
  kuaishou: Kling.Avatar as AvatarFC,
  trae: Trae.Avatar as AvatarFC,
  'qwen-tongyi': Alibaba.Avatar as AvatarFC,
  // 新增（2026-06）
  'xiaomi-mimo': XiaomiMiMo.Avatar as AvatarFC,
  github: Github.Avatar as AvatarFC,
  'new-api': NewAPI.Avatar as AvatarFC,
}

// ─── 组件 ───

type LogoSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE_PX: Record<LogoSize, number> = {
  sm: 20,
  md: 28,
  lg: 36,
  xl: 48,
}

type ProviderLogoProps = {
  vendor: VendorMeta | undefined | null
  size?: LogoSize | number
  shape?: 'square' | 'rounded' | 'circle'
  className?: string
  fallbackText?: string
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
  const avatarShape = shape === 'circle' ? 'circle' : 'square'
  const borderRadius =
    shape === 'circle' ? '50%' : shape === 'rounded' ? 'var(--r-sm)' : 'var(--r-md)'
  const fallback = fallbackText ?? vendor?.emoji ?? '?'

  // 1) 优先使用 Lobehub Avatar 彩色组件
  const AvatarComponent = vendor?.id ? VENDOR_AVATAR_MAP[vendor.id] : undefined
  if (AvatarComponent && !forceFallback) {
    return (
      <span
        className={`provider-logo provider-logo-${shape} ${className}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 'auto',
          height: 'auto',
          padding: 2,
          borderRadius,
          ...style,
        }}
        title={title ?? vendor?.name}
        aria-label={vendor?.name}
      >
        <AvatarComponent size={px} shape={avatarShape} />
      </span>
    )
  }

  // 2) 回退到本地图片资源
  const logoUrl = forceFallback ? null : resolveLocalLogo(vendor?.logoPath)
  const showImage = !!logoUrl && !errored

  if (showImage) {
    return (
      <span
        className={`provider-logo provider-logo-${shape} provider-logo-has-image ${className}`}
        style={{
          width: px,
          height: px,
          borderRadius,
          padding: 2,
          background: 'transparent',
          ...style,
        }}
        title={title ?? vendor?.name}
        aria-label={vendor?.name}
      >
        <img
          src={logoUrl}
          alt={vendor?.name ?? ''}
          className="provider-logo-img"
          onError={() => setErrored(true)}
          draggable={false}
        />
      </span>
    )
  }

  // 3) 最终回退：emoji 文字 + vendor 颜色
  return (
    <span
      className={`provider-logo provider-logo-${shape} ${className}`}
      style={{
        width: px,
        height: px,
        borderRadius,
        background: vendor?.color ?? 'var(--bg-soft)',
        color: '#fff',
        ...style,
      }}
      title={title ?? vendor?.name}
      aria-label={vendor?.name}
    >
      <span className="provider-logo-fallback">{fallback}</span>
    </span>
  )
}

export default ProviderLogo
