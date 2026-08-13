import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('canvas video presentation lifecycle', () => {
  it('uses a dedicated pure presentation policy for video and operation nodes', () => {
    const policyUrl = new URL('./canvasVideoNodePresentation.ts', import.meta.url)
    expect(existsSync(fileURLToPath(policyUrl))).toBe(true)
    expect(readSource('./CanvasStage.tsx')).toContain('resolveCanvasVideoNodePresentationSize')
    expect(readSource('./CanvasStage.tsx')).toContain('operationNodePresentationSize')
  })

  it('probes missing generated-video metadata before creating assets and nodes', () => {
    const api = readSource('./canvas.api.ts')
    expect(api).toContain("assetType === 'video'")
    expect(api).toContain('await readVideoDimensions(displayUrl)')
  })

  it('uses intrinsic video dimensions when planning expanded outputs', () => {
    const materialization = readSource('./canvasOperationOutputMaterialization.ts')
    expect(materialization).toContain('fitCanvasVideoNodeSize(output.width, output.height)')
    expect(materialization).not.toContain(
      "if (output.type === 'video') return VIDEO_NODE_DEFAULT_SIZE",
    )
  })

  it('backfills metadata from loaded standalone and task-output videos', () => {
    const node = readSource('./CanvasNode.tsx')
    const preview = readSource('./CanvasOperationOutputPreview.tsx')
    const runs = readSource('./canvasOperationRuns.ts')
    expect(node).toContain('mediaWidth')
    expect(node).toContain('mediaHeight')
    expect(preview).toContain('onVideoMetadata')
    expect(runs).toContain('node?.data.mediaWidth')
    expect(runs).toContain('node?.data.mediaHeight')
  })

  it('uses the custom fullscreen control in the operation output preview', () => {
    const preview = readSource('./CanvasOperationOutputPreview.tsx')
    const player = readSource('./videoPlayer/CanvasVideoPlayer.tsx')
    const controls = readSource('./videoPlayer/CanvasVideoPlayerControls.tsx')

    expect(preview).toContain("import { CanvasVideoPlayer } from './videoPlayer/CanvasVideoPlayer'")
    expect(player).toContain('controlsList="noremoteplayback"')
    expect(player).not.toContain('controls=""')
    expect(controls).toContain("aria-label={fullscreen ? '退出全屏' : '全屏'}")
  })
})
