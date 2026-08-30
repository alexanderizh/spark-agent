import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const panelSource = readFileSync(
  fileURLToPath(new URL('./CanvasOperationPanel.tsx', import.meta.url)),
  'utf8',
)

describe('operation parameter placement', () => {
  it('keeps the compact model and parameter entry alongside the full configuration panel', () => {
    expect(panelSource.match(/<CanvasOperationParameterControls/g)).toHaveLength(2)
    expect(panelSource).toContain('variant="toolbar"')
    expect(panelSource).toContain('variant="panel"')
  })
})
