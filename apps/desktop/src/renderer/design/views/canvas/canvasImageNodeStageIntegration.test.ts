import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stageSource = readFileSync(
  fileURLToPath(new URL('./CanvasStage.tsx', import.meta.url)),
  'utf8',
)

describe('canvas image node stage integration', () => {
  it('derives loaded image presentation size from its source asset dimensions', () => {
    expect(stageSource).toContain('resolveCanvasImageNodePresentationSize')
    expect(stageSource).toContain('const assetById = useMemo')
    expect(stageSource).toContain('assetById.get(node.assetId)')
  })

  it('does not reserve an auto-layout header for full-bleed image nodes', () => {
    expect(stageSource).toContain('isFullBleedCanvasImageNode(node.data.canvasNode)')
  })
})
