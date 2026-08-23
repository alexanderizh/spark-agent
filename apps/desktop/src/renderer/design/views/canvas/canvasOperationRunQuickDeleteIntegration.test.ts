import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readCanvasSource = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

describe('canvas operation run quick delete integration', () => {
  it('wires the node icon action through the stage to the safe run deletion flow', () => {
    const node = readCanvasSource('CanvasNode.tsx')
    const stage = readCanvasSource('CanvasStage.tsx')
    const workspace = readCanvasSource('CanvasWorkspaceView.tsx')

    expect(node).toContain('isCanvasOperationRunQuickDeletable(currentOperationRun)')
    expect(node).toContain('aria-label="删除本次运行记录"')
    expect(node).toContain('actions.deleteOperationRun?.(node.id, currentOperationRun)')
    expect(node).toContain('if (!activeRun && !overlayActions) return <>{fallback}</>')
    expect(stage).toContain('deleteOperationRun: onDeleteOperationRun')
    expect(workspace).toContain('deleteCanvasOperationRun({')
    expect(workspace).toContain(
      'flushTaskRuntimeWrites: () => flushCanvasTaskRuntimeWrites(projectId)',
    )
    expect(workspace).toContain('handleQuickDeleteOperationRun(nodeId, run)')
  })
})
