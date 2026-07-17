import { describe, expect, it } from 'vitest'
import type { CanvasMediaModelSummary, CanvasOperationType } from '@spark/protocol'
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

const multiDomainModel = {
  ...model,
  manifestId: 'test:all-media-capabilities',
  providerKind: 'custom',
  modelId: 'all-media-capabilities',
  effectiveModelId: 'all-media-capabilities',
  displayName: 'All media capabilities',
  domains: ['image', 'audio', 'video'],
  capabilities: [
    capability('image.generate'),
    capability('image.edit'),
    capability('audio.speech'),
    capability('audio.transcription'),
    capability('video.generate'),
    capability('video.image_to_video'),
    capability('video.edit'),
    capability('video.extend'),
  ],
} satisfies CanvasMediaModelSummary

function capability(id: string): CanvasMediaModelSummary['capabilities'][number] {
  return {
    id,
    label: id,
    input: { required: ['prompt'] },
    output: { types: [id.startsWith('audio.') ? 'audio' : id.startsWith('video.') ? 'video' : 'image'] },
    paramSchema: { type: 'object', properties: { marker: { type: 'string', title: id } } },
  }
}

describe('selectCanvasMediaCapability', () => {
  it.each<[CanvasOperationType, string]>([
    ['text_to_image', 'image.generate'],
    ['image_to_image', 'image.edit'],
    ['image_edit', 'image.edit'],
    ['image_compose', 'image.edit'],
    ['storyboard_grid', 'image.generate'],
    ['panorama_360', 'image.generate'],
    ['text_to_audio', 'audio.speech'],
    ['audio_transcribe', 'audio.transcription'],
    ['text_to_video', 'video.generate'],
    ['image_to_video', 'video.image_to_video'],
    ['video_edit', 'video.edit'],
    ['video_extend', 'video.extend'],
  ])('selects %s from the shared operation contract', (operation, expectedCapability) => {
    expect(
      selectCanvasMediaCapability({
        operation,
        model: multiDomainModel,
        selectedInputNodeIds: [],
        mediaInputOptions: [],
      })?.id,
    ).toBe(expectedCapability)
  })

  it('uses the first capability candidate actually exposed by the model', () => {
    expect(
      selectCanvasMediaCapability({
        operation: 'storyboard_grid',
        model: { ...multiDomainModel, capabilities: [capability('image.edit')] },
        selectedInputNodeIds: [],
        mediaInputOptions: [],
      })?.id,
    ).toBe('image.edit')
  })

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
