/**
 * ProviderLogo — 统一渲染供应商 logo（@lobehub/icons Avatar），失败时回退到本地图片或 emoji
 */
import {
  Alibaba,
  Anthropic,
  Azure,
  Baidu,
  Bailian,
  Bedrock,
  Bfl,
  ChatGLM,
  Claude,
  ClaudeCode,
  Codex,
  Cohere,
  Dalle,
  DeepSeek,
  ElevenLabs,
  Flux,
  Github,
  Gemini,
  Google,
  Grok,
  Hailuo,
  HuggingFace,
  HuaweiCloud,
  Ideogram,
  IFlyTekCloud,
  Infinigence,
  Kling,
  Kimi,
  Meta,
  Midjourney,
  Minimax,
  Mistral,
  Moonshot,
  NewAPI,
  Ollama,
  OpenAI,
  OpenRouter,
  Perplexity,
  Pika,
  PixVerse,
  Qwen,
  Replicate,
  Runway,
  SiliconCloud,
  Stability,
  StateCloud,
  Suno,
  Tencent,
  TencentCloud,
  Together,
  Trae,
  Udio,
  Volcengine,
  XAI,
  XiaomiMiMo,
  Zhipu,
} from '@lobehub/icons/es/icons'
import { modelMappings } from '@lobehub/icons/es/features/modelConfig'
import { providerMappings } from '@lobehub/icons/es/features/providerConfig'
import { createElement, useState, type CSSProperties, type ElementType } from 'react'
import type { ProviderIconConfig, ProviderIconStyle, VendorMeta } from '@spark/protocol'
import genericProviderIconUrl from '../../assets/providers/generic.png'

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

type AvatarComponent = ElementType<{ size: number; shape?: 'circle' | 'square' }>
type IconComponent = ElementType<{ size?: number; color?: string; type?: 'color' | 'mono' }>
type LobeIcon = IconComponent & {
  Avatar?: AvatarComponent
  Combine?: IconComponent
  title?: string
}

export type ProviderIconCatalogItem = {
  id: string
  label: string
  keywords: string[]
  icon: LobeIcon
}

const GENERIC_PROVIDER_ICON_ID = 'generic'

const GenericProviderIconBase: IconComponent = ({ size = 24 }) => (
  <img
    src={genericProviderIconUrl}
    width={size}
    height={size}
    alt=""
    aria-hidden="true"
    style={{ display: 'block', objectFit: 'contain' }}
  />
)

const GenericProviderIcon = GenericProviderIconBase as LobeIcon
GenericProviderIcon.title = '通用模型'
GenericProviderIcon.Avatar = ({ size }) => <GenericProviderIconBase size={size} />

const VENDOR_AVATAR_MAP: Record<string, AvatarComponent> = {
  openai: OpenAI.Avatar as AvatarComponent,
  anthropic: Anthropic.Avatar as AvatarComponent,
  claude: Claude.Avatar as AvatarComponent,
  'claude-auto-router': Claude.Avatar as AvatarComponent,
  'codex-auto-router': Codex.Avatar as AvatarComponent,
  // 内置本地 CLI provider（id 与 provider profile id 对齐）
  'local-claude-cli': ClaudeCode.Avatar as AvatarComponent,
  'local-codex-cli': Codex.Avatar as AvatarComponent,
  'google-gemini': Google.Avatar as AvatarComponent,
  'tencent-coding-plan': TencentCloud.Avatar as AvatarComponent,
  'aliyun-bailian-coding-plan': Bailian.Avatar as AvatarComponent,
  'zhipu-glm-coding-plan': Zhipu.Avatar as AvatarComponent,
  'qwen-standard': Qwen.Avatar as AvatarComponent,
  'deepseek-api': DeepSeek.Avatar as AvatarComponent,
  minimax: Minimax.Avatar as AvatarComponent,
  kimi: Moonshot.Avatar as AvatarComponent,
  siliconflow: SiliconCloud.Avatar as AvatarComponent,
  openrouter: OpenRouter.Avatar as AvatarComponent,
  ollama: Ollama.Avatar as AvatarComponent,
  xfyun: IFlyTekCloud.Avatar as AvatarComponent,
  ctyun: StateCloud.Avatar as AvatarComponent,
  baidu: Baidu.Avatar as AvatarComponent,
  volcengine: Volcengine.Avatar as AvatarComponent,
  huaweicloud: HuaweiCloud.Avatar as AvatarComponent,
  'infini-ai': Infinigence.Avatar as AvatarComponent,
  kuaishou: Kling.Avatar as AvatarComponent,
  trae: Trae.Avatar as AvatarComponent,
  'qwen-tongyi': Alibaba.Avatar as AvatarComponent,
  // 新增（2026-06）
  'xiaomi-mimo': XiaomiMiMo.Avatar as AvatarComponent,
  github: Github.Avatar as AvatarComponent,
  'new-api': NewAPI.Avatar as AvatarComponent,
}

export const PROVIDER_ICON_STYLES: Array<{ value: ProviderIconStyle; label: string }> = [
  { value: 'avatar', label: '头像' },
  { value: 'mono', label: '线性' },
]

const ICON_ID_BY_EXPORT_NAME: Record<string, string> = {
  ChatGLM: 'chatglm',
  ClaudeCode: 'claude-code',
  DeepSeek: 'deepseek',
  ElevenLabs: 'elevenlabs',
  HuggingFace: 'huggingface',
  IFlyTekCloud: 'iflytek',
  NewAPI: 'new-api',
  OpenAI: 'openai',
  OpenRouter: 'openrouter',
  PixVerse: 'pixverse',
  SiliconCloud: 'siliconcloud',
  StateCloud: 'statecloud',
  TencentCloud: 'tencentcloud',
  Volcengine: 'volcengine',
  XiaomiMiMo: 'xiaomi-mimo',
}

const ICON_KEYWORDS_BY_ID: Record<string, string[]> = {
  openai: ['gpt', 'chatgpt', 'dall-e'],
  anthropic: ['claude'],
  claude: ['anthropic'],
  google: ['gemini', 'imagen'],
  gemini: ['google'],
  deepseek: ['deepseek-api'],
  qwen: ['tongyi', '通义千问', 'aliyun'],
  alibaba: ['aliyun', '百炼', 'tongyi'],
  bailian: ['aliyun', '百炼'],
  kimi: ['moonshot', '月之暗面'],
  moonshot: ['kimi'],
  minimax: ['hailuo'],
  zhipu: ['glm', 'chatglm', '智谱'],
  chatglm: ['glm', 'zhipu'],
  xai: ['grok'],
  grok: ['xai'],
  mistral: ['mixtral'],
  meta: ['llama'],
  cohere: ['command'],
  perplexity: ['pplx'],
  together: ['together-ai'],
  openrouter: ['router'],
  ollama: ['local'],
  azure: ['microsoft'],
  bedrock: ['aws'],
  huggingface: ['hf'],
  stability: ['stable-diffusion'],
  flux: ['bfl', 'black-forest'],
  bfl: ['flux'],
  dalle: ['openai', 'image'],
  kling: ['kuaishou', '可灵', 'video'],
  hailuo: ['minimax', 'video'],
  elevenlabs: ['voice', 'audio'],
  baidu: ['千帆', 'ernie'],
  tencent: ['腾讯', 'hunyuan'],
  volcengine: ['火山', 'doubao', 'seedream'],
  huaweicloud: ['华为', 'pangu'],
  siliconcloud: ['siliconflow', '硅基流动'],
  iflytek: ['讯飞', 'spark'],
  statecloud: ['天翼云'],
  infinigence: ['无问芯穹'],
  'xiaomi-mimo': ['小米'],
  github: ['copilot'],
  codex: ['openai'],
  'claude-code': ['anthropic'],
  'new-api': ['openai-compatible'],
  trae: ['bytedance'],
}

const ICON_PRIORITY = [
  GENERIC_PROVIDER_ICON_ID,
  'openai',
  'anthropic',
  'claude',
  'google',
  'gemini',
  'deepseek',
  'qwen',
  'alibaba',
  'bailian',
  'kimi',
  'moonshot',
  'minimax',
  'zhipu',
  'chatglm',
  'xai',
  'grok',
  'mistral',
  'meta',
  'cohere',
  'perplexity',
  'together',
  'openrouter',
  'ollama',
]

const SUPPLEMENTAL_ICON_EXPORTS: Record<string, LobeIcon> = {
  Alibaba: Alibaba as LobeIcon,
  Anthropic: Anthropic as LobeIcon,
  Bailian: Bailian as LobeIcon,
  Claude: Claude as LobeIcon,
  ClaudeCode: ClaudeCode as LobeIcon,
  Codex: Codex as LobeIcon,
  Github: Github as LobeIcon,
  NewAPI: NewAPI as LobeIcon,
  OpenRouter: OpenRouter as LobeIcon,
  Tencent: Tencent as LobeIcon,
  TencentCloud: TencentCloud as LobeIcon,
  Trae: Trae as LobeIcon,
}

function normalizeIconExportId(exportName: string): string {
  return ICON_ID_BY_EXPORT_NAME[exportName] ?? exportName.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function isRenderableComponent(value: unknown): value is IconComponent {
  return typeof value === 'function' || (value != null && typeof value === 'object')
}

function resolveLobeIcon(value: unknown): LobeIcon | null {
  const candidate = isRenderableComponent(value) ? value : null
  const maybeDefault = candidate != null && typeof candidate === 'object'
    ? (candidate as { default?: unknown }).default
    : undefined
  const iconLike = isRenderableComponent(maybeDefault) ? maybeDefault : candidate
  if (!isRenderableComponent(iconLike)) return null
  const icon = iconLike as Partial<LobeIcon>
  return isRenderableComponent(icon.Avatar) || isRenderableComponent(icon.Combine)
    ? iconLike as LobeIcon
    : null
}

function buildProviderIconCatalog(iconExports: Record<string, unknown>): ProviderIconCatalogItem[] {
  const seen = new Set<string>([GENERIC_PROVIDER_ICON_ID])
  const priority = new Map(ICON_PRIORITY.map((id, index) => [id, index]))
  const catalog: ProviderIconCatalogItem[] = [
    {
      id: GENERIC_PROVIDER_ICON_ID,
      label: '通用模型',
      keywords: ['通用', '默认', '模型', 'generic', 'default', 'model', 'ai'],
      icon: GenericProviderIcon,
    },
  ]
  const addIcon = (exportName: string, icon: unknown, extraKeywords: string[] = []) => {
    const lobeIcon = resolveLobeIcon(icon)
    if (!lobeIcon) return
    const id = normalizeIconExportId(exportName)
    if (!id || seen.has(id)) return
    seen.add(id)
    const label = lobeIcon.title || exportName
    catalog.push({
      id,
      label,
      keywords: [exportName, ...extraKeywords, ...(ICON_KEYWORDS_BY_ID[id] ?? [])],
      icon: lobeIcon,
    })
  }
  for (const [exportName, icon] of Object.entries(iconExports)) {
    addIcon(exportName, icon)
  }
  return catalog.sort((a, b) => {
    const ap = priority.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const bp = priority.get(b.id) ?? Number.MAX_SAFE_INTEGER
    if (ap !== bp) return ap - bp
    return a.label.localeCompare(b.label, 'zh-Hans')
  })
}

const toCatalogEntry = (item: { Icon?: unknown; keywords?: string[] }): [string, unknown] => [
  (item.Icon as LobeIcon | undefined)?.title || String(item.keywords?.[0] ?? ''),
  item.Icon,
]

export const PROVIDER_ICON_CATALOG: ProviderIconCatalogItem[] = buildProviderIconCatalog(
  Object.fromEntries(
    [
      ...modelMappings.map(toCatalogEntry),
      ...providerMappings.map(toCatalogEntry),
      ...Object.entries(SUPPLEMENTAL_ICON_EXPORTS),
    ],
  ),
)

const PROVIDER_ICON_MAP: Record<string, ProviderIconCatalogItem> = Object.fromEntries(
  PROVIDER_ICON_CATALOG.map((item) => [item.id, item]),
)

const VENDOR_ICON_MAP: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  claude: 'claude',
  'claude-auto-router': 'claude',
  'codex-auto-router': 'codex',
  'local-claude-cli': 'claude-code',
  'local-codex-cli': 'codex',
  'google-gemini': 'gemini',
  'tencent-coding-plan': 'tencent',
  'aliyun-bailian-coding-plan': 'bailian',
  bailian: 'bailian',
  'zhipu-glm-coding-plan': 'zhipu',
  'qwen-standard': 'qwen',
  'deepseek-api': 'deepseek',
  minimax: 'minimax',
  kimi: 'kimi',
  siliconflow: 'siliconcloud',
  openrouter: 'openrouter',
  ollama: 'ollama',
  xfyun: 'iflytek',
  ctyun: 'statecloud',
  baidu: 'baidu',
  volcengine: 'volcengine',
  huaweicloud: 'huaweicloud',
  'infini-ai': 'infinigence',
  kuaishou: 'kling',
  trae: 'trae',
  'qwen-tongyi': 'alibaba',
  'xiaomi-mimo': 'xiaomi-mimo',
  github: 'github',
  'new-api': 'new-api',
}

export function normalizeProviderIconConfig(icon: ProviderIconConfig | null | undefined): ProviderIconConfig | null {
  if (!icon) return null
  const id = icon.id.trim().toLowerCase()
  if (!PROVIDER_ICON_MAP[id]) return null
  const style = icon.style === 'mono' ? icon.style : 'avatar'
  return { id, style }
}

export function getProviderIconForVendor(vendorId: string | undefined | null): ProviderIconConfig | null {
  if (!vendorId) return null
  const id = VENDOR_ICON_MAP[vendorId] ?? vendorId
  return normalizeProviderIconConfig({ id, style: 'avatar' })
}

function renderProviderIcon(icon: ProviderIconConfig, size: number, shape: 'circle' | 'square') {
  const normalized = normalizeProviderIconConfig(icon)
  if (!normalized) return null
  const item = PROVIDER_ICON_MAP[normalized.id]
  if (!item) return null
  const Icon = item.icon
  if (normalized.style === 'avatar' && Icon.Avatar) {
    return createElement(Icon.Avatar, { size, shape })
  }
  return createElement(Icon, { size, color: 'currentColor' })
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
  icon?: ProviderIconConfig | null | undefined
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
  icon,
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

  // 0) 用户手动选择的 LobeHub 图标优先；未传 icon 的旧调用点保持原逻辑。
  const customIcon = normalizeProviderIconConfig(icon)
  if (customIcon && !forceFallback) {
    return (
      <span
        className={`provider-logo provider-logo-${shape} provider-logo-custom ${className}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: px,
          height: px,
          padding: customIcon.style === 'avatar' ? 2 : 4,
          borderRadius,
          color: 'var(--text)',
          ...style,
        }}
        title={title ?? PROVIDER_ICON_MAP[customIcon.id]?.label ?? vendor?.name}
        aria-label={PROVIDER_ICON_MAP[customIcon.id]?.label ?? vendor?.name}
      >
        {renderProviderIcon(customIcon, customIcon.style === 'avatar' ? px : Math.max(14, px - 8), avatarShape)}
      </span>
    )
  }

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
