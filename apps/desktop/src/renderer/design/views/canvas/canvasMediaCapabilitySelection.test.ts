import { describe, expect, it } from 'vitest'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import { selectCanvasMediaCapability } from './canvasMediaCapabilitySelection'

const model = {
  manifestId: 'xai:grok-imagine-video',
  providerKind: 'xai',
  modelId: 'grok-imagine-video',
  effectiveModelId: 'grok-imagine-video',
  displayName: 'Grok Imagine Video',
  domains: ['video'],
  invocationMode: 'async_polling',
  capabilities: [
    {
      id: 'video.image_to_video',
      label: '图生视频',
      input: { required: ['image'], maxImages: 1 },
      output: { types: ['video'] },
      paramSchema: {},
    },
    {
      id: 'video.reference_to_video',
      label: '参考图生视频',
      input: { required: ['prompt', 'image'], maxImages: 7 },
      output: { types: ['video'] },
      paramSchema: {},
    },
  ],
  sourceUrls: [],
  enabled: true,
} satisfies CanvasMediaModelSummary

const images = [
  { value: 'image-1', type: 'image' },
  { value: 'image-2', type: 'image' },
]

describe('selectCanvasMediaCapability', () => {
  it('uses reference-to-video for multiple unassigned images', () => {
    expect(
      selectCanvasMediaCapability({
        operation: 'image_to_video',
        model,
        selectedInputNodeIds: ['image-1', 'image-2'],
        mediaInputOptions: images,
      })?.id,
    ).toBe('video.reference_to_video')
  })

  it('keeps first-frame image-to-video when the user selected an explicit frame', () => {
    expect(
      selectCanvasMediaCapability({
        operation: 'image_to_video',
        model,
        selectedInputNodeIds: ['image-1', 'image-2'],
        mediaInputOptions: images,
        firstFrameNodeId: 'image-1',
        lastFrameNodeId: 'image-2',
      })?.id,
    ).toBe('video.image_to_video')
  })

  it('uses reference-to-video for a single explicitly tagged reference', () => {
    expect(
      selectCanvasMediaCapability({
        operation: 'image_to_video',
        model,
        selectedInputNodeIds: ['image-1'],
        mediaInputOptions: images,
        referenceFrameNodeIds: ['image-1'],
      })?.id,
    ).toBe('video.reference_to_video')
  })
})
