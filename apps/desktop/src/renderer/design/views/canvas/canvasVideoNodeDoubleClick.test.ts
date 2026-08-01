import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const nodeSource = readFileSync(fileURLToPath(new URL('./CanvasNode.tsx', import.meta.url)), 'utf8')
const workspaceSource = readFileSync(
  fileURLToPath(new URL('./CanvasWorkspaceView.tsx', import.meta.url)),
  'utf8',
)

describe('canvas video node double click', () => {
  it('prevents native video preview and dispatches the node editor action', () => {
    expect(nodeSource).toContain('onClickCapture={(event) => {')
    expect(nodeSource).toContain('onDoubleClickCapture={(event) => {')
    expect(nodeSource).toContain('if (event.detail < 2) return')
    expect(nodeSource).toContain('controlsList="nofullscreen noremoteplayback"')
    expect(nodeSource).toContain('event.preventDefault()')
    expect(nodeSource).not.toContain("if (node.type === 'video') return")
    expect(nodeSource).toContain('actions.editNode(node.id)')
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
    expect(workspaceSource).toContain("import { replaceCanvasVideoNode } from './canvasMediaNodeReplacement'")
    expect(workspaceSource).toContain('onReplaceVideo={handleReplaceVideo}')
  })
})
