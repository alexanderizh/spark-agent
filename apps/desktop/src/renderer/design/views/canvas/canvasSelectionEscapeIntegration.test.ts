import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stageSource = readFileSync(
  fileURLToPath(new URL('./CanvasStage.tsx', import.meta.url)),
  'utf8',
)

describe('canvas selection Escape integration', () => {
  it('routes an unhandled Escape key to selection clearing', () => {
    expect(stageSource).toContain('shouldClearCanvasSelectionOnEscape')
    expect(stageSource).toMatch(/selectedNodeCount:\s*selectedNodeIds\.length/)
    expect(stageSource).toContain('onSelectionChange([])')
  })
})
