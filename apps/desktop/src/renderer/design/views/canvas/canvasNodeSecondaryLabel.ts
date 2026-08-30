import { isOperationNode } from './canvas.capabilities'
import type { CanvasAsset, CanvasNode } from './canvas.types'

export function canvasNodeSecondaryLabel(
  node: CanvasNode,
  asset?: CanvasAsset,
  options: { isResourceOutput?: boolean; isTextContentNode?: boolean } = {},
): string {
  const fileName = canvasNodeFileName(node, asset)
  if (fileName) return fileName

  if (isOperationNode(node)) {
    return canvasOperationRuntimeSummary(node) ?? '运行记录'
  }
  if (options.isResourceOutput || node.data.origin === 'task_output') return '画布产物'
  if (node.type === 'group') return '成组排列'
  if (node.data.subtype === 'director_stage_3d') return '导演场景'
  if (node.data.subtype === 'video_workbench') return '视频工程'
  if (node.type === 'image') return node.data.panorama360 ? '360° 全景' : '图片资产'
  if (node.type === 'video') return '视频资产'
  if (node.type === 'audio') return '音频资产'
  if (
    options.isTextContentNode ||
    ((node.type === 'text' || node.type === 'prompt') && !isOperationNode(node))
  ) {
    return `${(node.data.text ?? node.data.message ?? '').length} 字`
  }
  return '可编辑'
}

export function canvasOperationRuntimeSummary(node: CanvasNode): string | null {
  const model = typeof node.data.modelId === 'string' ? node.data.modelId.trim() : ''
  if (model) return `模型 ${model}`
  const manifest = typeof node.data.manifestId === 'string' ? node.data.manifestId.trim() : ''
  if (manifest) return `工作流 ${manifest}`
  const provider =
    typeof node.data.providerProfileId === 'string' ? node.data.providerProfileId.trim() : ''
  return provider ? `Provider ${provider}` : null
}

function canvasNodeFileName(node: CanvasNode, asset?: CanvasAsset): string | null {
  const metadata = asset?.metadata ?? {}
  const candidates = [
    metadata.fileName,
    metadata.filename,
    metadata.originalName,
    metadata.originalFilename,
  ]
  for (const value of candidates) {
    if (typeof value !== 'string' || !value.trim()) continue
    return fileNameFromPath(value)
  }

  for (const value of [node.data.url, asset?.url]) {
    if (typeof value !== 'string' || !value.trim()) continue
    const fileName = fileNameFromPath(value)
    if (fileName) return fileName
  }

  const assetTitle = asset?.title?.trim()
  if (assetTitle && assetTitle !== node.title?.trim()) return assetTitle
  if (asset?.storageKey) return fileNameFromPath(asset.storageKey)
  return null
}

function fileNameFromPath(value: string): string {
  if (/^(?:data|blob):/i.test(value)) return ''
  let pathWithoutQuery = value.split(/[?#]/, 1)[0] ?? value
  try {
    pathWithoutQuery = new URL(value).pathname
  } catch {
    // Relative paths and storage keys are handled by the path split below.
  }
  const fileName = pathWithoutQuery.split(/[\\/]/).pop() ?? pathWithoutQuery
  try {
    return decodeURIComponent(fileName)
  } catch {
    return fileName
  }
}
