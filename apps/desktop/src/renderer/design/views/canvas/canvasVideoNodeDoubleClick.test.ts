import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const nodeSource = readFileSync(fileURLToPath(new URL('./CanvasNode.tsx', import.meta.url)), 'utf8')
const workspaceSource = readFileSync(
  fileURLToPath(new URL('./CanvasWorkspaceView.tsx', import.meta.url)),
  'utf8',
)

describe('canvas video node double click', () => {
  it('uses the custom player and dispatches the node editor action on video double click', () => {
    const playerSource = readFileSync(
      fileURLToPath(new URL('./videoPlayer/CanvasVideoPlayer.tsx', import.meta.url)),
      'utf8',
    )

    expect(nodeSource).toContain(
      "import { CanvasVideoPlayer } from './videoPlayer/CanvasVideoPlayer'",
    )
    expect(nodeSource).toContain('onDoubleClickEdit={() => actions.editNode(node.id)}')
    expect(playerSource).toContain('if (event.target === videoRef.current) onDoubleClickEdit?.()')
    expect(playerSource).not.toContain('controls=""')
    expect(nodeSource).not.toContain("if (node.type === 'video') return")
  })

  it('routes plain video nodes to the generic node edit panel', () => {
    expect(workspaceSource).not.toContain('普通视频节点双击 → 直接打开视频工作台')
    expect(workspaceSource).not.toMatch(
      /if \(node\?\.type === 'video'[^}]*setVideoWorkbenchNodeId\(nodeId\)/s,
    )
    expect(workspaceSource).toContain('setEditingNodeId(nodeId)')
  })

  it('uploads an empty video from the node content area through the shared replacement helper', () => {
    expect(nodeSource).toContain('canvasNodeInlinePrimaryAction(node)')
    expect(nodeSource).toContain('className="canvas-node-inline-primary-action')
    expect(nodeSource).toContain('accept="video/*"')
    expect(nodeSource).toContain('actions.replaceVideo?.(node.id, file)')
    expect(workspaceSource).toContain('replaceCanvasVideoNode')
    expect(workspaceSource).toContain('onReplaceVideo={handleReplaceVideo}')
  })
})
