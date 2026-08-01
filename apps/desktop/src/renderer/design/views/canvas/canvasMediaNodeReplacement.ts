import { encodeToSafeFileUrl } from './canvas-safe-file'
import { fitCanvasVideoNodeSize } from './canvasNodeSize'
import type { CanvasNode, CanvasNodeData } from './canvas.types'

export type PreparedCanvasVideoUpload = {
  filePath: string
  fileMimeType?: string
  mediaWidth?: number
  mediaHeight?: number
  durationMs?: number
}

export async function replaceCanvasVideoNode(input: {
  node: CanvasNode
  file: File
  prepare: (file: File, kind: 'video') => Promise<PreparedCanvasVideoUpload>
  toSafeUrl?: (path: string) => string
  patchNode: (
    nodeId: string,
    patch: Pick<CanvasNode, 'width' | 'height' | 'x' | 'y'>,
  ) => Promise<void> | void
  updateNodeData: (nodeId: string, data: Partial<CanvasNodeData>) => Promise<void> | void
}): Promise<void> {
  if (input.node.type !== 'video') throw new Error('未找到目标视频节点')
  if (!input.file.type.startsWith('video/')) throw new Error('请选择视频文件')

  const prepared = await input.prepare(input.file, 'video')
  const nextSize = fitCanvasVideoNodeSize(prepared.mediaWidth, prepared.mediaHeight)
  const centerX = input.node.x + input.node.width / 2
  const centerY = input.node.y + input.node.height / 2

  await input.patchNode(input.node.id, {
    width: nextSize.width,
    height: nextSize.height,
    x: Math.round(centerX - nextSize.width / 2),
    y: Math.round(centerY - nextSize.height / 2),
  })
  await input.updateNodeData(input.node.id, {
    url: (input.toSafeUrl ?? encodeToSafeFileUrl)(prepared.filePath),
    mimeType: prepared.fileMimeType ?? input.file.type,
    ...(prepared.mediaWidth ? { mediaWidth: prepared.mediaWidth } : {}),
    ...(prepared.mediaHeight ? { mediaHeight: prepared.mediaHeight } : {}),
    ...(prepared.durationMs ? { durationMs: prepared.durationMs } : {}),
  })
}
