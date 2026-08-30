import { describe, expect, it } from 'vitest'
import { canvasNodeInlinePrimaryAction } from './canvasNodeInlinePrimaryAction'
import type { CanvasNode } from './canvas.types'

function node(
  type: CanvasNode['type'],
  data: CanvasNode['data'] = {},
): Pick<CanvasNode, 'type' | 'data'> {
  return { type, data }
}

describe('canvasNodeInlinePrimaryAction', () => {
  it('offers editing inside an empty text node', () => {
    expect(canvasNodeInlinePrimaryAction(node('text'))).toEqual({
      kind: 'edit',
      label: '编辑内容',
    })
  })

  it('offers direct upload inside an empty video node', () => {
    expect(canvasNodeInlinePrimaryAction(node('video'))).toEqual({
      kind: 'upload-video',
      label: '上传视频',
    })
  })

  it('does not cover nodes that already have content', () => {
    expect(canvasNodeInlinePrimaryAction(node('text', { text: '已有内容' }))).toBeNull()
    expect(canvasNodeInlinePrimaryAction(node('video', { url: 'safe-file://video' }))).toBeNull()
  })
})
