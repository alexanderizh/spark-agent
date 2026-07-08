import { describe, expect, it } from 'vitest'
import {
  MediaContractIssueSchema,
  MediaContractWarningSchema,
  MediaDroppedParamSchema,
  MediaErrorContractSchema,
  MediaModelParamPolicySchema,
} from '../media-model-contract.js'
import { MediaModelManifestSchema } from '../media-model-manifest.js'
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

describe('MediaModelParamPolicySchema', () => {
  it('accepts an empty policy', () => {
    expect(MediaModelParamPolicySchema.parse({})).toEqual({})
  })

  it('accepts strict + passthrough allowlist', () => {
    const parsed = MediaModelParamPolicySchema.parse({
      strict: true,
      passthrough: { enabled: false, allow: ['style'], deny: ['debug'] },
      aliases: { aspectRatio: 'ratio' },
      forbidden: [{ name: 'outputFormat', reason: 'model does not support png/jpeg switch' }],
      conflicts: [{ fields: ['durationSeconds', 'frames'], strategy: 'prefer_first' }],
      transforms: [
        { kind: 'rename', from: 'size', to: 'aspectRatio' },
        { kind: 'map_value', field: 'aspectRatio', values: { 智能比例: 'adaptive' } },
        { kind: 'ratio_size_to_aspect', from: 'size', to: 'aspectRatio' },
        { kind: 'drop_when_input_kind', field: 'size', inputKinds: ['video'] },
      ],
    })
    expect(parsed.strict).toBe(true)
  })

  it('rejects conflicts rule with fewer than 2 fields', () => {
    expect(() =>
      MediaModelParamPolicySchema.parse({
        conflicts: [{ fields: ['durationSeconds'], strategy: 'prefer_first' }],
      }),
    ).toThrow()
  })
})

describe('MediaErrorContractSchema', () => {
  it('accepts a volcengine-style contract', () => {
    const parsed = MediaErrorContractSchema.parse({
      codePaths: ['error.code'],
      messagePaths: ['error.message'],
      requestIdPaths: ['RequestId', 'request_id'],
      paramNamePatterns: ['parameter `([a-z_]+)`'],
      mappings: {
        InvalidParameter: 'unsupported_parameter',
        Unauthorized: 'auth_failed',
      },
      retryableCodes: ['Throttling'],
    })
    expect(parsed.mappings?.InvalidParameter).toBe('unsupported_parameter')
  })

  it('rejects empty string in codePaths', () => {
    expect(() =>
      MediaErrorContractSchema.parse({
        codePaths: [''],
      }),
    ).toThrow()
  })

  it('rejects unknown normalized error code in mappings', () => {
    expect(() =>
      MediaErrorContractSchema.parse({
        mappings: { InvalidParameter: 'totally_unknown_code' as never },
      }),
    ).toThrow()
  })
})

describe('MediaDroppedParamSchema / Warning / Issue', () => {
  it('accepts a dropped param with reason unsupported_by_model', () => {
    const parsed = MediaDroppedParamSchema.parse({
      name: 'outputFormat',
      providerName: 'output_format',
      valuePreview: 'png',
      reason: 'unsupported_by_model',
    })
    expect(parsed.reason).toBe('unsupported_by_model')
  })

  it('accepts a compat_passthrough warning and an invalid_enum issue', () => {
    expect(
      MediaContractWarningSchema.parse({
        code: 'compat_passthrough',
        message: '当前模型使用兼容参数透传',
      }).code,
    ).toBe('compat_passthrough')

    expect(
      MediaContractIssueSchema.parse({
        severity: 'error',
        code: 'invalid_enum',
        message: 'quality must be one of standard, hd',
        path: ['quality'],
      }).code,
    ).toBe('invalid_enum')
  })
})

describe('MediaModelManifestSchema with Contract V2 fields', () => {
  it('still accepts old manifests without paramPolicy / error', () => {
    expect(() => MediaModelManifestSchema.parse(manifest())).not.toThrow()
  })

  it('accepts manifest with capability.paramPolicy and top-level error', () => {
    const m = manifest({
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'] },
          paramSchema: {
            type: 'object',
            properties: {
              aspectRatio: { type: 'string', enum: ['1:1', '16:9'] },
              outputFormat: { type: 'string', enum: ['png', 'jpeg'] },
            },
          },
          paramPolicy: {
            strict: true,
            passthrough: { enabled: false },
            forbidden: [{ name: 'outputFormat', reason: '当前模型不支持切换 outputFormat' }],
          },
        },
      ],
      error: {
        codePaths: ['error.code'],
        messagePaths: ['error.message'],
        requestIdPaths: ['RequestId'],
        paramNamePatterns: ['parameter `([a-z_]+)`'],
        mappings: { InvalidParameter: 'unsupported_parameter' },
      },
    })
    expect(() => MediaModelManifestSchema.parse(m)).not.toThrow()
  })
})

describe('validateMediaModelManifestSemantics — Contract V2', () => {
  it('flags forbidden field that is not declared in schema or aliases', () => {
    const m = manifest({
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'] },
          paramSchema: { type: 'object', properties: { quality: { type: 'string' } } },
          paramPolicy: {
            forbidden: [{ name: 'mystery', reason: 'should fail' }],
          },
        },
      ],
    })
    const issues = validateMediaModelManifestSemantics(m)
    expect(
      issues.some(
        (i) => i.code === 'invalid_param_policy' && i.message.includes('mystery'),
      ),
    ).toBe(true)
  })

  it('flags allow/deny overlap', () => {
    const m = manifest({
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'] },
          paramSchema: { type: 'object', properties: { quality: { type: 'string' } } },
          paramPolicy: {
            passthrough: { enabled: true, allow: ['style'], deny: ['style'] },
          },
        },
      ],
    })
    const issues = validateMediaModelManifestSemantics(m)
    expect(
      issues.some(
        (i) => i.code === 'invalid_param_policy' && i.message.includes('style'),
      ),
    ).toBe(true)
  })

  it('flags conflict rule with fewer than 2 fields', () => {
    const m = manifest({
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'] },
          paramSchema: { type: 'object', properties: { quality: { type: 'string' } } },
          paramPolicy: {
            conflicts: [{ fields: ['durationSeconds'], strategy: 'prefer_first' }],
          },
        },
      ],
    })
    const issues = validateMediaModelManifestSemantics(m)
    expect(
      issues.some((i) => i.code === 'invalid_param_policy' && i.message.includes('fields')),
    ).toBe(true)
  })

  it('flags empty string in error contract paths', () => {
    const m = manifest({
      error: {
        codePaths: ['error.code', ''],
      },
    })
    const issues = validateMediaModelManifestSemantics(m)
    expect(
      issues.some(
        (i) => i.code === 'invalid_error_contract' && i.message.includes('codePaths'),
      ),
    ).toBe(true)
  })

  it('does not flag paramPolicy when absent (legacy manifests)', () => {
    const issues = validateMediaModelManifestSemantics(manifest())
    expect(issues.some((i) => i.code === 'invalid_param_policy')).toBe(false)
    expect(issues.some((i) => i.code === 'invalid_error_contract')).toBe(false)
  })
})
