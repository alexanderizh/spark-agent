import type {
  CanvasImageAnnotationDocument,
  CanvasImageAnnotationRef,
  CanvasNode,
} from '../canvas.types'

export function annotationBaseName(node: CanvasNode): string {
  return (
    (node.title || 'image')
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image'
  )
}

export function createCanvasImageAnnotationRef(input: {
  documentPath: string
  document: CanvasImageAnnotationDocument
  sourceNode: CanvasNode
}): CanvasImageAnnotationRef {
  return {
    schemaVersion: 1,
    documentPath: input.documentPath,
    sourceNodeId: input.sourceNode.id,
    ...(input.sourceNode.assetId ? { sourceAssetId: input.sourceNode.assetId } : {}),
    artboard: {
      width: input.document.artboard.width,
      height: input.document.artboard.height,
      background: input.document.artboard.background,
      padding: input.document.artboard.padding,
    },
    updatedAt: input.document.updatedAt,
  }
}

/**
 * 只有由当前节点自己产生的引用才是尚未结算的草稿。
 * 完成后生成的新图片节点会保留上一轮侧车引用用于追溯，但默认应以新图片本身开启下一轮标注。
 */
export function resolveCanvasImageAnnotationDraftPath(node: CanvasNode | null): string | null {
  const annotation = node?.data.imageAnnotation
  if (!node || !annotation || annotation.sourceNodeId !== node.id) return null
  return annotation.documentPath
}

export async function saveCanvasImageAnnotationDocument(input: {
  document: CanvasImageAnnotationDocument
  sourceNode: CanvasNode
  projectRootPath?: string | null
  existingFilePath?: string | null
}): Promise<string> {
  const baseName = annotationBaseName(input.sourceNode)
  const response = await window.spark.invoke('file:save-canvas-annotation', {
    documentJson: JSON.stringify(input.document),
    suggestedBaseName: `${baseName}-annotation`,
    ...(input.projectRootPath ? { projectRootPath: input.projectRootPath } : {}),
    ...(input.existingFilePath ? { existingFilePath: input.existingFilePath } : {}),
  })
  return response.filePath
}
