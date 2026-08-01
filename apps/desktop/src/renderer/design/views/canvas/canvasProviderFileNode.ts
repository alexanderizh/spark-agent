import type { CanvasNode } from './canvas.types'

export type CanvasProviderFileNodeInput = {
  providerProfileId: string
  fileId: string
  fileName?: string
  mimeType?: string
  kind?: 'image' | 'video' | 'audio'
  x: number
  y: number
  width?: number
  height?: number
}

export function resolveProviderFileTaskProfile(input: {
  nodes: readonly CanvasNode[]
  selectedProviderProfileId?: string | null | undefined
}): string | null {
  const sourceProfileIds = Array.from(
    new Set(
      input.nodes
        .filter((node) => Boolean(node.data.fileId))
        .map((node) => node.data.providerProfileId?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  )
  if (sourceProfileIds.length > 1) {
    throw new Error('Provider 文件来自多个渠道配置，请只保留同一配置下的文件后重试')
  }
  const sourceProfileId = sourceProfileIds[0]
  const selectedProfileId = input.selectedProviderProfileId?.trim() || undefined
  if (sourceProfileId && selectedProfileId && sourceProfileId !== selectedProfileId) {
    throw new Error('所选模型渠道与 Provider 文件来源不一致，请切换到上传该文件的 MiniMax 配置')
  }
  return selectedProfileId ?? sourceProfileId ?? null
}
