import { describe, expect, it } from 'vitest'
import type { MediaModelManifest } from '../media-model-manifest.js'
import { validateMediaModelManifestSemantics } from '../media-model-manifest-validation.js'

function manifest(overrides: Partial<MediaModelManifest> = {}): MediaModelManifest {
  return {
    id: 'custom:test-image',
    providerKind: 'custom',
    modelId: 'test-image-v1',
    displayName: 'Test Image',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] },
        output: { types: ['image'] },
        paramSchema: {
          type: 'object',
          properties: {
            quality: { type: 'string', enum: ['standard', 'hd'] },
            n: { type: 'integer', minimum: 1, maximum: 4 },
          },
        },
        defaults: { quality: 'standard', n: 1 },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/images',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', quality: '{{quality}}' },
      response: { kind: 'url', jsonPaths: ['data[].url'], download: true },
    },
    docs: { sourceUrls: [] },
    ...overrides,
  }
}

describe('validateMediaModelManifestSemantics', () => {
  it('accepts a valid JSON template manifest', () => {
    expect(validateMediaModelManifestSemantics(manifest())).toEqual([])
  })

  it('requires task polling metadata for async polling mode', () => {
    const issues = validateMediaModelManifestSemantics(
      manifest({
        invocation: { ...manifest().invocation, mode: 'async_polling' },
      }),
    )

    expect(issues.map((issue) => issue.path.join('.'))).toContain('invocation.response')
    expect(issues.map((issue) => issue.path.join('.'))).toContain('invocation.polling')
  })

  it('rejects unknown template variables before a provider call', () => {
    const value = manifest()
    value.invocation.requestTemplate = { prompt: '{{prompt}}', mystery: '{{unknownField}}' }

    const issues = validateMediaModelManifestSemantics(value)
    expect(issues.some((issue) => issue.message.includes('unknownField'))).toBe(true)
  })

  it('rejects defaults that violate enum and numeric ranges', () => {
    const value = manifest()
    value.capabilities[0]!.defaults = { quality: 'ultra', n: 0 }

    const issues = validateMediaModelManifestSemantics(value)
    expect(issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['capabilities.0.defaults.quality', 'capabilities.0.defaults.n']),
    )
  })
})
