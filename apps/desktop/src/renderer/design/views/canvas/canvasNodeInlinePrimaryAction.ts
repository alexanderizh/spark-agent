import type { CanvasNode } from './canvas.types'

export type CanvasNodeInlinePrimaryAction = {
  kind: 'edit' | 'upload-video'
  label: string
}

export function canvasNodeInlinePrimaryAction(
  node: Pick<CanvasNode, 'type' | 'data'>,
): CanvasNodeInlinePrimaryAction | null {
  if (node.type === 'video') {
    return node.data.url?.trim() ? null : { kind: 'upload-video', label: '上传视频' }
  }
  if (node.type !== 'text' && node.type !== 'prompt') return null
  const content = (node.data.text ?? node.data.prompt ?? node.data.message ?? '').trim()
  return content ? null : { kind: 'edit', label: '编辑内容' }
}
