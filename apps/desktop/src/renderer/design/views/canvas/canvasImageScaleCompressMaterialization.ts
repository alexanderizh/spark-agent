import type { CanvasNode } from './canvas.types'
import { copyLocalArtifactIntoProject } from './canvasArtifactPersistence'

export type CanvasImageScaleCompressMaterializationInput = {
  projectId: string
  boardId: string
  parentNodeId: string
  anchorNodeId?: string
  filePath: string
  fileName: string
  mimeType?: string | null
  scalePercent: number
  compressPercent: number
  onProgress?: (progress: { percent: number; stage: string }) => void
}

type CreateImageNodeInput = {
  projectId: string
  boardId: string
  file: File
  filePath: string
  fileSize?: number
  x: number
  y: number
  imageWidth?: number
  imageHeight?: number
}

type MaterializationDependencies = {
  parent: Pick<CanvasNode, 'x' | 'y' | 'width'>
  createImageNode: (input: CreateImageNodeInput) => Promise<CanvasNode>
  connectGeneratedNode: (node: CanvasNode) => void
}

type ImageScaleCompressResult = {
  path?: string
  width?: number
  height?: number
  format?: string
  outputBytes?: number
}

function outputDescriptor(
  sourceFileName: string,
  format: string | undefined,
): { baseName: string; fileName: string; mimeType: string } {
  const outputFormat = format === 'jpeg' || format === 'webp' || format === 'png' ? format : null
  if (!outputFormat) throw new Error('图片处理结果缺少有效的输出格式')
  const mimeType =
    outputFormat === 'jpeg' ? 'image/jpeg' : outputFormat === 'webp' ? 'image/webp' : 'image/png'
  const extension = outputFormat === 'jpeg' ? 'jpg' : (outputFormat ?? 'png')
  const sourceBaseName = sourceFileName.replace(/\.[^.]+$/, '').trim() || 'image'
  const baseName = `${sourceBaseName} 尺寸压缩`
  return { baseName, fileName: `${baseName}.${extension}`, mimeType }
}

/** 调用图片处理 IPC、持久化产物并创建图片节点；画布存储接线由调用方注入。 */
export async function materializeCanvasImageScaleCompress(
  input: CanvasImageScaleCompressMaterializationInput,
  dependencies: MaterializationDependencies,
): Promise<CanvasNode> {
  const requestId = `image_scale_compress_${crypto.randomUUID()}`
  const unsubscribe = input.onProgress
    ? window.spark.on('stream:image:process-progress', (progress) => {
        if (progress.requestId !== requestId) return
        input.onProgress?.({ percent: progress.percent, stage: progress.stage })
      })
    : null

  try {
    const response = await window.spark.invoke('image:process', {
      operation: 'scaleCompress',
      input: input.filePath,
      params: { scalePercent: input.scalePercent, compressPercent: input.compressPercent },
      requestId,
    })
    const result = response.result as ImageScaleCompressResult | undefined
    if (!response.success || !result?.path) {
      throw new Error(response.error ?? '图片处理失败')
    }

    const descriptor = outputDescriptor(input.fileName, result.format)
    const persistedPath =
      (await copyLocalArtifactIntoProject({
        projectId: input.projectId,
        sourcePath: result.path,
        type: 'image',
        suggestedBaseName: descriptor.baseName,
      })) ?? result.path

    const node = await dependencies.createImageNode({
      projectId: input.projectId,
      boardId: input.boardId,
      file: new File([], descriptor.fileName, { type: descriptor.mimeType }),
      filePath: persistedPath,
      ...(typeof result.outputBytes === 'number' && result.outputBytes > 0
        ? { fileSize: result.outputBytes }
        : {}),
      x: dependencies.parent.x + dependencies.parent.width + 48,
      y: dependencies.parent.y,
      ...(typeof result.width === 'number' && result.width > 0 ? { imageWidth: result.width } : {}),
      ...(typeof result.height === 'number' && result.height > 0
        ? { imageHeight: result.height }
        : {}),
    })
    dependencies.connectGeneratedNode(node)
    return node
  } finally {
    unsubscribe?.()
  }
}
