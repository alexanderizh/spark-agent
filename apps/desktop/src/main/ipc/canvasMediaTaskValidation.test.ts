import { describe, expect, it } from 'vitest'
import type {
  CanvasMediaPruneModelParamsRequest,
  MediaModelCapabilityManifest,
  MediaModelManifest,
} from '@spark/protocol'
import {
  mapCanvasMediaTaskInputFiles,
  validateCanvasMediaTaskParams,
} from './canvasMediaTaskValidation.js'

const capability: MediaModelCapabilityManifest = {
  id: 'video.image_to_video',
  label: '图生视频',
  input: { required: ['prompt', 'image'], maxImages: 1 },
  output: { types: ['video'] },
  paramSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      durationSeconds: { type: 'integer', minimum: 1, maximum: 10 },
    },
  },
}

const manifest: MediaModelManifest = {
  id: 'custom:test-video',
  providerKind: 'custom',
  modelId: 'test-video',
  displayName: 'Test Video',
  domains: ['video'],
  capabilities: [capability],
  invocation: {
    mode: 'sync',
    endpoint: '/generate',
    method: 'POST',
    contentType: 'json',
    requestTemplate: {},
    response: { kind: 'url', jsonPaths: ['data.url'], download: true },
  },
  docs: { sourceUrls: [] },
}

describe('validateCanvasMediaTaskParams', () => {
  it('preserves media role and metadata for runtime validation', () => {
    expect(
      mapCanvasMediaTaskInputFiles([
        {
          type: 'video',
          role: 'reference',
          url: 'https://example.com/reference.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 1024,
          width: 1920,
          height: 1080,
          durationMs: 5000,
        },
      ]),
    ).toEqual([
      {
        type: 'video',
        role: 'reference',
        url: 'https://example.com/reference.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1024,
        width: 1920,
        height: 1080,
        durationMs: 5000,
      },
    ])
  })

  it('returns all blocking issues before task submission', () => {
    const request: CanvasMediaPruneModelParamsRequest = {
      manifestId: manifest.id,
      capabilityId: capability.id,
      modelId: manifest.modelId,
      prompt: '',
      modelParams: { durationSeconds: 12 },
      inputFiles: [
        { type: 'image', url: 'https://example.com/1.png' },
        { type: 'image', url: 'https://example.com/2.png' },
      ],
      validateSubmission: true,
    }

    const result = validateCanvasMediaTaskParams({
      request,
      manifest,
      capability,
    })

    expect(result.validationIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['missing_required', 'out_of_range']),
    )
    expect(
      result.validationIssues.some((issue) => issue.message.includes('最多支持 1 张图片')),
    ).toBe(true)
  })

  it('keeps canonical parameter names after validation for native adapters', () => {
    const aliasedCapability: MediaModelCapabilityManifest = {
      ...capability,
      aliases: { durationSeconds: 'duration' },
    }
    const result = validateCanvasMediaTaskParams({
      request: {
        manifestId: manifest.id,
        capabilityId: aliasedCapability.id,
        modelId: manifest.modelId,
        prompt: 'animate',
        modelParams: { durationSeconds: 8 },
        inputFiles: [{ type: 'image', url: 'https://example.com/frame.png' }],
        validateSubmission: true,
      },
      manifest: { ...manifest, capabilities: [aliasedCapability] },
      capability: aliasedCapability,
    })

    expect(result.prunedModelParams).toEqual({ durationSeconds: 8 })
  })
})
