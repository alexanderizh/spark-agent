import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('canvas node handle styles', () => {
  it('lets handles escape node shells while keeping node content clipped', () => {
    const stylesheet = readFileSync(
      fileURLToPath(new URL('./CanvasWorkspaceView.less', import.meta.url)),
      'utf8',
    )
    const flowNodeRule = stylesheet.match(
      /\.canvas-stage \.react-flow__node\s*\{([^}]*)\}/,
    )?.[1]
    const shellRule = stylesheet.match(/\.canvas-node-shell\s*\{([^}]*)\}/)?.[1]
    const coreRule = stylesheet.match(/\.canvas-node-core\s*\{([^}]*)\}/)?.[1]
    const handleRule = stylesheet.match(/\.canvas-node-handle\s*\{([^}]*)\}/)?.[1]

    expect(flowNodeRule).toMatch(/overflow:\s*visible\s*!important\s*;/)
    expect(shellRule).toMatch(/overflow:\s*visible\s*!important\s*;/)
    expect(coreRule).toMatch(/overflow:\s*hidden\s*;/)
    expect(handleRule).toBeDefined()
    expect(handleRule).toMatch(/z-index:\s*8\s*;/)
  })
})
