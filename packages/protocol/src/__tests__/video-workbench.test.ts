import { describe, expect, it } from 'vitest'
import {
  VIDEO_WORKBENCH_RENDER_PLAN_VERSION,
  VideoWorkbenchRenderPlanSchema,
} from '../video-workbench'

function createPlan() {
  return {
    renderPlanVersion: VIDEO_WORKBENCH_RENDER_PLAN_VERSION,
    project: {
      width: 1920,
      height: 1080,
      fps: 30,
      backgroundColor: '#000000',
      audioSampleRate: 48_000,
    },
    range: { startSec: 0, endSec: 10 },
    inputs: [
      { id: 'video:1', kind: 'video' as const, path: '/project/video.mp4', durationSec: 10 },
      { id: 'image:1', kind: 'image' as const, path: '/project/image.png' },
    ],
    tracks: [
      {
        id: 'track:main',
        kind: 'video' as const,
        order: 0,
        enabled: true,
        clips: [
          {
            id: 'clip:video',
            kind: 'video' as const,
            inputId: 'video:1',
            timelineStartSec: 0,
            durationSec: 10,
            sourceInSec: 0,
            sourceOutSec: 10,
            speed: 1,
            transform: {
              x: 0,
              y: 0,
              scaleX: 1,
              scaleY: 1,
              rotationDeg: 0,
              opacity: 1,
              mirrorX: false,
              mirrorY: false,
            },
          },
        ],
      },
    ],
    output: {
      path: '/project/output.mp4',
      container: 'mp4' as 'mp4' | 'mov' | 'webm',
      videoCodec: 'libx264' as const,
      audioCodec: 'aac' as const,
      crf: 20,
      pixelFormat: 'yuv420p' as const,
    },
  }
}

describe('VideoWorkbenchRenderPlanSchema', () => {
  it('accepts a structured plan without arbitrary filter strings', () => {
    const plan = createPlan()
    const result = VideoWorkbenchRenderPlanSchema.safeParse(plan)
    expect(result.success).toBe(true)
    expect(JSON.stringify(plan)).not.toContain('filterComplex')
  })

  it('rejects missing and type-incompatible input references', () => {
    const missing = createPlan()
    missing.tracks[0]!.clips[0]!.inputId = 'missing'
    expect(VideoWorkbenchRenderPlanSchema.safeParse(missing).success).toBe(false)

    const incompatible = createPlan()
    incompatible.tracks[0]!.clips[0]!.inputId = 'image:1'
    expect(VideoWorkbenchRenderPlanSchema.safeParse(incompatible).success).toBe(false)
  })

  it('rejects duplicate identities and invalid render ranges', () => {
    const plan = createPlan()
    plan.inputs.push({ ...plan.inputs[0]! })
    plan.range.endSec = 0
    const result = VideoWorkbenchRenderPlanSchema.safeParse(plan)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'duplicate input id video:1',
        'render range must have positive duration',
      ]),
    )
  })

  it('rejects source ranges beyond the input and container/codec mismatches', () => {
    const plan = createPlan()
    plan.tracks[0]!.clips[0]!.sourceOutSec = 11
    plan.output.container = 'webm'
    const result = VideoWorkbenchRenderPlanSchema.safeParse(plan)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'clip source range exceeds input video:1 duration',
        'output codecs are incompatible with the selected container',
      ]),
    )
  })
})
