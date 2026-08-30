import { downloadCanvasResource } from './CanvasAssetsPanel'
import { isCanvasImageContentNode } from './canvas.capabilities'
import { canvasNodeDownloadName } from './canvasNodeNaming'
import type { CanvasAsset, CanvasNode } from './canvas.types'

export async function downloadCanvasNodeResource(input: {
  sourceNode: CanvasNode
  resourceNode: CanvasNode | null
  assets: CanvasAsset[]
}): Promise<boolean> {
  const resolved = input.resourceNode
  const resolvedKind: 'image' | 'video' | 'audio' | null =
    resolved && !isCanvasImageContentNode(resolved)
      ? resolved.type === 'video'
        ? 'video'
        : resolved.type === 'audio'
          ? 'audio'
          : null
      : resolved
        ? 'image'
        : null
  if (!resolved || resolvedKind == null) return false

  const linkedAsset = resolved.assetId
    ? (input.assets.find((item) => item.id === resolved.assetId) ?? null)
    : null
  await downloadCanvasResource({
    id: linkedAsset?.id ?? resolved.id,
    type: linkedAsset?.type ?? resolvedKind,
    title: linkedAsset?.title ?? resolved.title ?? null,
    suggestedFileName: canvasNodeDownloadName(
      input.sourceNode,
      linkedAsset?.title ?? resolved.title,
      resolvedKind === 'video' ? '视频' : resolvedKind === 'audio' ? '音频' : '图片',
    ),
    mimeType: linkedAsset?.mimeType ?? resolved.data.mimeType ?? null,
    storageKey: linkedAsset?.storageKey ?? resolved.data.filePath ?? null,
    url: resolved.data.url ?? linkedAsset?.url ?? null,
    thumbnailUrl: resolved.data.thumbnailUrl ?? linkedAsset?.thumbnailUrl ?? null,
    contentText: linkedAsset?.contentText ?? null,
  })
  return true
}
