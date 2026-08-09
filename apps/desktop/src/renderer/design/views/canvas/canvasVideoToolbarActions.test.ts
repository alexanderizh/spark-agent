import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readSource = () =>
  readFileSync(fileURLToPath(new URL('./CanvasNode.tsx', import.meta.url)), 'utf8')

describe('canvas video toolbar actions', () => {
  it('exposes edit and audio extraction actions for video content nodes', () => {
    const source = readSource()

    expect(source).toContain('const videoToolbarSourceNodeId =')
    expect(source).toContain("key: 'edit-video'")
    expect(source).toContain("label: '视频编辑'")
    expect(source).toContain("key: 'extract-audio'")
    expect(source).toContain("label: '分离音频'")
    expect(source).toContain("actions.createOperationChild(videoToolbarSourceNodeId, 'extract_audio')")
  })

  it('does not expose video actions without a video URL', () => {
    const source = readSource()

    expect(source).toContain('contentNode?.type === \'video\' && contentNode.data.url')
    expect(source).toContain('operationOutputState.primaryOutput?.nodeId ?? null')
  })
})
