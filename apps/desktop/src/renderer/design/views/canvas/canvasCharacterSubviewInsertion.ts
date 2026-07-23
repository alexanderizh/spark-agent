import { fitCanvasImageNodeSize } from './canvasNodeSize'
import type { FilmCharacterSubview } from './canvasCharacterLibrary'
import type { CanvasAsset, CanvasNode } from './canvas.types'

const CHARACTER_SUBVIEW_NODE_GAP = 60

type CreateImageNodeInput = {
  file: File
  filePath: string
  x: number
  y: number
  width?: number
  height?: number
  imageWidth?: number
  imageHeight?: number
}

export type CharacterSubviewInsertionDependencies = {
  cropToDataUrl: (sourceImageUrl: string, cropPx: FilmCharacterSubview['cropPx']) => Promise<string>
  dataUrlToFile: (dataUrl: string, fileName: string) => File
  saveImage: (input: {
    dataUrl: string
    mimeType: string
    suggestedBaseName: string
  }) => Promise<{ filePath: string }>
  createImageNode: (input: CreateImageNodeInput) => Promise<CanvasNode | void>
  patchNodes: (nodeIds: string[], patch: Partial<CanvasNode>) => Promise<unknown>
  updateNodeData: (nodeId: string, data: CanvasNode['data']) => Promise<unknown>
  connectNodes: (input: { sourceNodeId: string; targetNodeId: string }) => Promise<unknown>
  selectNode: (nodeId: string) => void
}

export function resolveCharacterSubviewCanvasSourceNode(input: {
  preferredSourceNodeId?: string
  sourceAssetId: string
  canvasNodes: CanvasNode[]
}): CanvasNode | null {
  const preferred = input.preferredSourceNodeId
    ? input.canvasNodes.find((node) => node.id === input.preferredSourceNodeId && !node.hidden)
    : undefined
  if (preferred) return preferred
  return (
    input.canvasNodes.find((node) => !node.hidden && node.assetId === input.sourceAssetId) ?? null
  )
}

export async function insertCharacterSubviewToCanvas(
  input: {
    sourceNode: CanvasNode
    canvasNodes: CanvasNode[]
    ownerAsset: CanvasAsset
    sourceImageAsset: CanvasAsset
    sourceImageUrl: string
    subview: FilmCharacterSubview
  },
  dependencies: CharacterSubviewInsertionDependencies,
): Promise<CanvasNode | null> {
  const { sourceNode, canvasNodes, ownerAsset, sourceImageAsset, sourceImageUrl, subview } = input
  const sourcePosition = resolveAbsoluteNodePosition(sourceNode, canvasNodes)
  const dataUrl = await dependencies.cropToDataUrl(sourceImageUrl, subview.cropPx)
  const fileBaseName = sanitizeFilePart(ownerAsset.title || sourceImageAsset.title || 'image', 40)
  const viewName = sanitizeFilePart(subview.label || 'detail', 24)
  const fileName = `${fileBaseName}-${viewName}-${Date.now()}.png`
  const file = dependencies.dataUrlToFile(dataUrl, fileName)
  const savedImage = await dependencies.saveImage({
    dataUrl,
    mimeType: file.type || 'image/png',
    suggestedBaseName: fileName.replace(/\.[^.]+$/, ''),
  })
  const imageWidth = normalizedDimension(subview.cropPx.width)
  const imageHeight = normalizedDimension(subview.cropPx.height)
  const nodeSize = fitCanvasImageNodeSize(imageWidth, imageHeight)
  const node = await dependencies.createImageNode({
    file,
    filePath: savedImage.filePath,
    x: Math.round(sourcePosition.x + sourceNode.width + CHARACTER_SUBVIEW_NODE_GAP),
    y: Math.round(sourcePosition.y),
    width: nodeSize.width,
    height: nodeSize.height,
    imageWidth,
    imageHeight,
  })
  if (!node) return null

  dependencies.selectNode(node.id)
  await dependencies.connectNodes({ sourceNodeId: sourceNode.id, targetNodeId: node.id })
  await dependencies.patchNodes([node.id], { title: subview.label || '子视图' })
  await dependencies.updateNodeData(node.id, {
    ...node.data,
    message: `从原产物提取子视图「${subview.label || '未命名'}」`,
    ...(sourceNode.data.pipelineRole ? { pipelineRole: sourceNode.data.pipelineRole } : {}),
    modelParams: {
      ...(node.data.modelParams ?? {}),
      characterSubview: {
        sourceNodeId: sourceNode.id,
        sourceAssetId: sourceImageAsset.id,
        ownerAssetId: ownerAsset.id,
        subviewId: subview.id,
        cropPx: subview.cropPx,
      },
    },
  })
  return node
}

function resolveAbsoluteNodePosition(
  sourceNode: CanvasNode,
  canvasNodes: CanvasNode[],
): { x: number; y: number } {
  const nodesById = new Map(canvasNodes.map((node) => [node.id, node]))
  const visited = new Set([sourceNode.id])
  let x = sourceNode.x
  let y = sourceNode.y
  let current = sourceNode

  while (current.parentNodeId && !visited.has(current.parentNodeId)) {
    const parent = nodesById.get(current.parentNodeId)
    if (!parent) break
    visited.add(parent.id)
    x += parent.x
    y += parent.y
    current = parent
  }
  return { x, y }
}

function sanitizeFilePart(value: string, maxLength: number): string {
  return (
    value
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLength) || 'image'
  )
}

function normalizedDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1
}
