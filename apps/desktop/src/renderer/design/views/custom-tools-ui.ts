import type { CustomToolSummary, ProviderProfile } from '@spark/protocol'

export function customToolTypeLabel(type: CustomToolSummary['type']): string {
  if (type === 'provider-vision') return '图像理解'
  if (type === 'http') return 'HTTP'
  if (type === 'code') return '代码'
  return type.toUpperCase()
}

export function isSupportedVisionProvider(profile: ProviderProfile): boolean {
  return (
    profile.enabled !== false &&
    profile.modelType === 'multimodal' &&
    profile.provider !== 'anthropic' &&
    profile.codexApiKind !== 'responses' &&
    profile.codexApiKind !== 'embedding'
  )
}

export function preferredVisionProvider(profiles: ProviderProfile[]): ProviderProfile | undefined {
  const supported = profiles.filter(isSupportedVisionProvider)
  return (
    supported.find((profile) => profile.name.trim() === '自部署图像理解') ??
    supported.find((profile) => profile.name.includes('图像理解')) ??
    supported[0]
  )
}

export function formatCustomToolTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function customToolFileName(filePath: string): string {
  return filePath.split(/[\\/]/u).pop() || filePath
}

/** Renderer-side counterpart of SafeFileProtocol.toSafeFileUrl. */
export function customToolImagePreviewUrl(absolutePath: string): string {
  const encoded = btoa(unescape(encodeURIComponent(absolutePath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `safe-file://x/${encoded}`
}
