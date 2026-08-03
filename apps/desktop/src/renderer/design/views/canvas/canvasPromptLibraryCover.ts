import type { CanvasAsset, CanvasNode } from './canvas.types'

/** 提示词封面只接受图片资产；URL 是否存在不能代表资产是图片。 */
export function isPromptCoverAsset(asset: CanvasAsset | null | undefined): asset is CanvasAsset {
  return asset?.type === 'image'
}

export function isPromptCoverNode(
  node: Pick<CanvasNode, 'type'> | null | undefined,
  asset: CanvasAsset | null | undefined,
): asset is CanvasAsset {
  return node?.type === 'image' && isPromptCoverAsset(asset)
}
