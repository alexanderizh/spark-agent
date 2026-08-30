import { describe, expect, it } from 'vitest'
import type { CanvasProject } from '../canvas.types'
import {
  DEFAULT_STEP_STUDIO_META,
  STEP_STUDIO_META_KEY,
  STEP_STUDIO_STATE_KEY,
  readStepStudioMeta,
  readStepStudioState,
  stepStudioMetaPatch,
  type StepStudioProjectMeta,
} from './stepStudioMeta'

function projectWithMetadata(
  metadata: Record<string, unknown> | undefined,
): Pick<CanvasProject, 'metadata'> {
  if (metadata == null) {
    const withoutMetadata: Pick<CanvasProject, 'metadata'> = {}
    return withoutMetadata
  }
  return { metadata }
}

describe('readStepStudioMeta', () => {
  it('returns canvas defaults when metadata is missing', () => {
    expect(readStepStudioMeta(projectWithMetadata(undefined))).toEqual(DEFAULT_STEP_STUDIO_META)
    expect(readStepStudioMeta(projectWithMetadata({}))).toEqual(DEFAULT_STEP_STUDIO_META)
  })

  it('returns defaults for non-object or corrupted values', () => {
    expect(readStepStudioMeta(projectWithMetadata({ [STEP_STUDIO_META_KEY]: 'step' }))).toEqual(
      DEFAULT_STEP_STUDIO_META,
    )
    expect(readStepStudioMeta(projectWithMetadata({ [STEP_STUDIO_META_KEY]: [1, 2] }))).toEqual(
      DEFAULT_STEP_STUDIO_META,
    )
    expect(readStepStudioMeta(projectWithMetadata({ [STEP_STUDIO_META_KEY]: null }))).toEqual(
      DEFAULT_STEP_STUDIO_META,
    )
  })

  it('falls back per-field when only part of the meta is valid', () => {
    expect(
      readStepStudioMeta(projectWithMetadata({ [STEP_STUDIO_META_KEY]: { lastMode: 'step' } })),
    ).toEqual({ lastMode: 'step', activeStep: 'setup' })
    expect(
      readStepStudioMeta(
        projectWithMetadata({
          [STEP_STUDIO_META_KEY]: { lastMode: 'bogus', activeStep: 'assembly' },
        }),
      ),
    ).toEqual({ lastMode: 'canvas', activeStep: 'assembly' })
  })

  it('reads back a fully valid meta', () => {
    expect(
      readStepStudioMeta(
        projectWithMetadata({
          [STEP_STUDIO_META_KEY]: { lastMode: 'step', activeStep: 'storyboard' },
        }),
      ),
    ).toEqual({ lastMode: 'step', activeStep: 'storyboard' })
  })
})

describe('meta patches', () => {
  it('stepStudioMetaPatch targets the stepStudio key with a plain copy', () => {
    const meta: StepStudioProjectMeta = { lastMode: 'step', activeStep: 'setup' }
    const patch = stepStudioMetaPatch(meta)
    expect(patch).toEqual({ stepStudio: { lastMode: 'step', activeStep: 'setup' } })
    // patch 内是副本：后续改动元对象不污染 patch
    meta.lastMode = 'canvas'
    expect((patch[STEP_STUDIO_META_KEY] as { lastMode: string }).lastMode).toBe('step')
  })
})

describe('readStepStudioState', () => {
  it('returns null when the state key is missing or invalid', () => {
    expect(readStepStudioState(projectWithMetadata(undefined))).toBeNull()
    expect(readStepStudioState(projectWithMetadata({}))).toBeNull()
    expect(
      readStepStudioState(projectWithMetadata({ [STEP_STUDIO_STATE_KEY]: { schemaVersion: 2 } })),
    ).toBeNull()
    expect(
      readStepStudioState(projectWithMetadata({ [STEP_STUDIO_STATE_KEY]: { schemaVersion: 1 } })),
    ).toBeNull()
    expect(
      readStepStudioState(
        projectWithMetadata({
          [STEP_STUDIO_STATE_KEY]: { schemaVersion: 1, sequences: 'nope' },
        }),
      ),
    ).toBeNull()
  })

  it('accepts a schema v1 state with empty sequences', () => {
    const state = { schemaVersion: 1, sequences: [] }
    expect(readStepStudioState(projectWithMetadata({ [STEP_STUDIO_STATE_KEY]: state }))).toEqual(
      state,
    )
  })
})
