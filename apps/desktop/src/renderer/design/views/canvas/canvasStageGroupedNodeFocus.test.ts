import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stageSource = readFileSync(
  fileURLToPath(new URL('./CanvasStage.tsx', import.meta.url)),
  'utf8',
)

describe('canvas stage grouped node focus', () => {
  it('uses React Flow absolute node bounds when centering nodes inside groups', () => {
    expect(stageSource).toContain('instance.getInternalNode(nodeId)')
    expect(stageSource).toContain('instance.getNodesBounds(nodesToCenter)')
    expect(stageSource).not.toContain('minX: Math.min(acc.minX, node.position.x)')
  })
})
