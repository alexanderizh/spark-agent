import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workspaceSource = readFileSync(
  fileURLToPath(new URL('./CanvasWorkspaceView.tsx', import.meta.url)),
  'utf8',
)

function readHandlerSource(name: string, nextName: string): string {
  const start = workspaceSource.indexOf(`const ${name}`)
  const end = workspaceSource.indexOf(`const ${nextName}`, start)
  if (start < 0 || end < 0) return ''
  return workspaceSource.slice(start, end)
}

describe('canvas Agent panel interaction', () => {
  it('keeps the Agent panel open when node selection settles after adding a node to chat', () => {
    const source = readHandlerSource(
      'handleNodeSelectIntent',
      'handleCanvasViewportControlsChange',
    )

    expect(source).toContain("closeCanvasFloatPanels('agent')")
    expect(source).not.toContain('closeCanvasFloatPanels()')
  })
})
