import { describe, expect, it } from 'vitest'
import {
  CANVAS_GENERAL_CREATE_OPERATION_GROUPS,
  CANVAS_PIPELINE_CREATE_OPERATIONS,
  canvasGeneralCreateOperations,
} from './canvasNodeGenerationMenu'

describe('canvasNodeGenerationMenu', () => {
  it('places storyboard and panorama only in the screenplay pipeline group', () => {
    expect(CANVAS_PIPELINE_CREATE_OPERATIONS.map((item) => item.operation)).toEqual([
      'storyboard_grid',
      'panorama_360',
    ])
    const generalOperationIds = canvasGeneralCreateOperations().map((item) => item.operation)
    expect(generalOperationIds).not.toContain('storyboard_grid')
    expect(generalOperationIds).not.toContain('panorama_360')
  })

  it('keeps operation ids unique across groups', () => {
    const allOperationIds = [
      ...CANVAS_PIPELINE_CREATE_OPERATIONS,
      ...CANVAS_GENERAL_CREATE_OPERATION_GROUPS.flatMap((group) => group.items),
    ].map((item) => item.operation)
    expect(new Set(allOperationIds).size).toBe(allOperationIds.length)
  })

  it('retains image, text, video, and audio groups', () => {
    expect(CANVAS_GENERAL_CREATE_OPERATION_GROUPS.map((group) => group.id)).toEqual([
      'image',
      'text',
      'video',
      'audio',
    ])
  })
})
