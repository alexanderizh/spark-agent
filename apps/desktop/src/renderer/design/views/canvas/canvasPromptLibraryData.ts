import type { CanvasAsset, CanvasNode } from './canvas.types'
import { isPromptCoverAsset } from './canvasPromptLibraryCover'

type PromptAssetData = Pick<CanvasAsset, 'contentText' | 'metadata'>

function readAttributes(asset: PromptAssetData): Record<string, unknown> {
  const attributes = asset.metadata?.attributes
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return {}
  return attributes as Record<string, unknown>
}

export function readPromptLibraryText(asset: PromptAssetData): string {
  const contentText = asset.contentText
  if (typeof contentText === 'string' && contentText.trim()) return contentText.trim()

  const prompt = asset.metadata?.prompt
  return typeof prompt === 'string' ? prompt.trim() : ''
}

export function readPromptLibraryCover(
  asset: Pick<CanvasAsset, 'contentText' | 'metadata'>,
  assets: readonly CanvasAsset[],
): { assetId: string | null; url: string | null; mimeType: string | null } {
  const attributes = readAttributes(asset)
  const coverAssetId =
    typeof attributes.coverAssetId === 'string' ? attributes.coverAssetId.trim() : ''

  if (coverAssetId) {
    const coverAsset = assets.find((candidate) => candidate.id === coverAssetId)
    if (!isPromptCoverAsset(coverAsset)) {
      return { assetId: null, url: null, mimeType: null }
    }
    return {
      assetId: coverAsset.id,
      url: coverAsset.thumbnailUrl ?? coverAsset.url ?? null,
      mimeType: coverAsset.mimeType ?? null,
    }
  }

  const coverUrl = typeof attributes.coverUrl === 'string' ? attributes.coverUrl.trim() : ''
  const coverMimeType =
    typeof attributes.coverMimeType === 'string' ? attributes.coverMimeType.trim() : ''
  if (!coverUrl || !/^image\//i.test(coverMimeType)) {
    return { assetId: null, url: null, mimeType: null }
  }

  return { assetId: null, url: coverUrl, mimeType: coverMimeType }
}

export function isPromptTextNode(node: Pick<CanvasNode, 'type'> | null | undefined): boolean {
  return node?.type === 'text' || node?.type === 'prompt'
}
