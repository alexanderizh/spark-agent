import { describe, expect, it } from 'vitest'
import type {
  MediaModelCapabilityManifest,
  MediaModelManifest,
} from '@spark/protocol'
import { compileMediaRequest } from '../../../services/media/media-request-compiler.js'

function buildManifest(overrides: Partial<MediaModelManifest> = {}): MediaModelManifest {
  return {
    id: 'custom:test',
    providerKind: 'custom',
    modelId: 'test-v1',
    displayName: 'Test',
    domains: ['image'],
    capabilities: [],
    invocation: {
      mode: 'sync',
      endpoint: '/images',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {},
      response: { kind: 'url', jsonPaths: ['data[].url'], download: true },
    },
    docs: { sourceUrls: [] },
    ...overrides,
  }
}

function imageCapability(overrides: Partial<MediaModelCapabilityManifest> = {}): MediaModelCapabilityManifest {
  return {
    id: 'image.generate',
    label: '文生图',
    input: { required: ['prompt'] },
    output: { types: ['image'] },
    paramSchema: {
      type: 'object',
      properties: {
        aspectRatio: { type: 'string', enum: ['1:1', '16:9'] },
        outputFormat: { type: 'string', enum: ['png', 'jpeg'] },
        n: { type: 'integer', minimum: 1, maximum: 4 },
      },
    },
    defaults: { n: 1 },
    ...overrides,
  }
}

function compile(opts: {
  manifest?: MediaModelManifest
  capability?: MediaModelCapabilityManifest
  modelParams?: Record<string, unknown>
  inputFiles?: Array<{ type: string; role?: string }>
  mode?: 'canvas' | 'mcp' | 'adapter'
}) {
  const capability = opts.capability ?? imageCapability()
  const manifest = opts.manifest ?? buildManifest({ capabilities: [capability] })
  return compileMediaRequest({
    manifest,
    capability,
    modelId: manifest.modelId,
    input: {
      ...(opts.modelParams !== undefined ? { modelParams: opts.modelParams } : {}),
      ...(opts.inputFiles !== undefined ? { inputFiles: opts.inputFiles } : {}),
    },
    mode: opts.mode ?? 'adapter',
  })
}

describe('compileMediaRequest — Documented Scenarios', () => {
  it('scenario 1: drops output_format when schema does not declare it', () => {
    const capability: MediaModelCapabilityManifest = {
      id: 'image.generate',
      label: '文生图',
      input: { required: ['prompt'] },
      output: { types: ['image'] },
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // 故意不声明 outputFormat / output_format
          aspectRatio: { type: 'string', enum: ['1:1', '16:9'] },
        },
      },
      paramPolicy: { strict: true, passthrough: { enabled: false } },
    }
    const result = compile({ capability, modelParams: { output_format: 'png' } })
    expect(result.providerParams).not.toHaveProperty('output_format')
    expect(result.providerParams).not.toHaveProperty('outputFormat')
    expect(result.droppedParams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'outputFormat', reason: 'unsupported_by_model' }),
      ]),
    )
  })

  it('scenario 2: keeps outputFormat when schema declares it (canonical)', () => {
    const result = compile({ modelParams: { outputFormat: 'png' } })
    expect(result.providerParams.outputFormat).toBe('png')
  })

  it('scenario 3: drops unknown param "foo" under strict policy', () => {
    const result = compile({
      capability: imageCapability({
        paramPolicy: { strict: true, passthrough: { enabled: false } },
      }),
      modelParams: { foo: 'bar' },
    })
    expect(result.providerParams).not.toHaveProperty('foo')
    expect(result.droppedParams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'foo', reason: 'unsupported_by_model' }),
      ]),
    )
  })

  it('scenario 4: passthrough.allow lets "style" reach provider params', () => {
    const result = compile({
      capability: imageCapability({
        paramPolicy: {
          strict: true,
          passthrough: { enabled: true, allow: ['style'] },
        },
      }),
      modelParams: { style: 'cinematic' },
    })
    expect(result.providerParams.style).toBe('cinematic')
    expect(result.warnings.some((w) => w.code === 'compat_passthrough')).toBe(true)
  })

  it('scenario 5: passthrough.deny always drops "debug"', () => {
    const result = compile({
      capability: imageCapability({
        paramPolicy: { strict: false, passthrough: { enabled: true, deny: ['debug'] } },
      }),
      modelParams: { debug: 1 },
    })
    expect(result.providerParams).not.toHaveProperty('debug')
    expect(result.droppedParams.some((d) => d.name === 'debug')).toBe(true)
  })

  it('scenario 6: filename never reaches provider params', () => {
    const result = compile({ modelParams: { filename: 'my-image.png' } })
    expect(result.providerParams).not.toHaveProperty('filename')
    expect(result.droppedParams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'filename', reason: 'local_only' }),
      ]),
    )
  })

  it('scenario 7: aspectRatio alias maps to provider ratio', () => {
    const result = compile({
      capability: imageCapability({
        aliases: { aspectRatio: 'ratio' },
      }),
      modelParams: { aspectRatio: '16:9' },
    })
    expect(result.providerParams.ratio).toBe('16:9')
    expect(result.providerParams).not.toHaveProperty('aspectRatio')
  })

  it('scenario 8: durationSeconds alias maps to provider duration', () => {
    const manifest = buildManifest({
      domains: ['video'],
      capabilities: [
        {
          id: 'video.generate',
          label: '文生视频',
          input: { required: ['prompt'] },
          output: { types: ['video'] },
          paramSchema: {
            type: 'object',
            properties: { durationSeconds: { type: 'integer', minimum: 1, maximum: 60 } },
          },
          aliases: { durationSeconds: 'duration' },
        },
      ],
    })
    const capability = manifest.capabilities[0]!
    const result = compile({
      manifest,
      capability,
      modelParams: { durationSeconds: 8 },
    })
    expect(result.providerParams.duration).toBe(8)
    expect(result.providerParams).not.toHaveProperty('durationSeconds')
  })

  it('scenario 9: enum/range/type violations produce validationIssues', () => {
    const result = compile({
      capability: imageCapability(),
      modelParams: { outputFormat: 'gif', n: 99 },
    })
    expect(result.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_enum', path: ['outputFormat'] }),
        expect.objectContaining({ code: 'out_of_range', path: ['n'] }),
      ]),
    )
    expect(result.providerParams).not.toHaveProperty('outputFormat')
    expect(result.providerParams).not.toHaveProperty('n')
  })

  it('scenario 10: x-allow-custom lets declared enum fields keep custom scalar values', () => {
    const result = compile({
      capability: imageCapability({
        paramSchema: {
          type: 'object',
          properties: {
            size: {
              type: 'string',
              enum: ['2K', '4K', '2048x2048'],
              'x-allow-custom': true,
            },
          },
        },
      }),
      modelParams: { size: '3750x1250' },
      mode: 'canvas',
    })
    expect(result.providerParams.size).toBe('3750x1250')
    expect(result.validationIssues.some((issue) => issue.code === 'invalid_enum')).toBe(false)
  })

  it('passes custom parameters through a synthesized provider manifest', () => {
    const capability = imageCapability({
      paramSchema: {
        type: 'object',
        properties: { size: { type: 'string', enum: ['1K', '2K'] } },
      },
    })
    const result = compile({
      manifest: buildManifest({
        id: 'custom:qwen-image',
        providerKind: 'bailian',
        capabilities: [capability],
      }),
      capability,
      modelParams: { size: '2048*1024', n: 1, filename: 'qwen.png' },
    })

    expect(result.providerParams).toMatchObject({ size: '2048*1024', n: 1 })
    expect(result.providerParams).not.toHaveProperty('filename')
    expect(result.validationIssues).toEqual([])
  })
})

describe('compileMediaRequest — Backward compatibility', () => {
  it('auto-derives strict from additionalProperties:false (no paramPolicy needed)', () => {
    const capability: MediaModelCapabilityManifest = {
      id: 'image.generate',
      label: '文生图',
      input: { required: ['prompt'] },
      output: { types: ['image'] },
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { quality: { type: 'string' } },
      },
    }
    const result = compile({ capability, modelParams: { quality: 'hd', foo: 'bar' } })
    expect(result.providerParams.quality).toBe('hd')
    expect(result.providerParams).not.toHaveProperty('foo')
  })

  it('emits missing_param_policy warning when additionalProperties is true and policy absent', () => {
    const capability: MediaModelCapabilityManifest = {
      id: 'image.generate',
      label: '文生图',
      input: { required: ['prompt'] },
      output: { types: ['image'] },
      paramSchema: {
        type: 'object',
        additionalProperties: true,
        properties: { quality: { type: 'string' } },
      },
    }
    const result = compile({ capability, modelParams: { quality: 'hd' } })
    expect(result.warnings.some((w) => w.code === 'missing_param_policy')).toBe(true)
  })

  it('canonicalizes snake_case to camelCase before validation', () => {
    const result = compile({
      capability: imageCapability(),
      modelParams: { aspect_ratio: '16:9', output_format: 'png' },
    })
    expect(result.providerParams.aspectRatio).toBe('16:9')
    // output_format -> outputFormat: png is declared -> should pass through
    expect(result.providerParams.outputFormat).toBe('png')
  })

  it('drops forbidden param and emits error issue in adapter mode', () => {
    const result = compile({
      capability: imageCapability({
        paramPolicy: {
          forbidden: [{ name: 'outputFormat', reason: '当前模型不支持切换' }],
        },
      }),
      modelParams: { outputFormat: 'png' },
      mode: 'adapter',
    })
    expect(result.providerParams).not.toHaveProperty('outputFormat')
    expect(result.validationIssues.some((i) => i.code === 'forbidden_param')).toBe(true)
    expect(result.droppedParams.some((d) => d.reason === 'forbidden_by_contract')).toBe(true)
  })

  it('drops forbidden param but stays silent in canvas mode', () => {
    const result = compile({
      capability: imageCapability({
        paramPolicy: {
          forbidden: [{ name: 'outputFormat', reason: '当前模型不支持切换' }],
        },
      }),
      modelParams: { outputFormat: 'png' },
      mode: 'canvas',
    })
    expect(result.providerParams).not.toHaveProperty('outputFormat')
    expect(result.validationIssues.some((i) => i.code === 'forbidden_param')).toBe(false)
    expect(result.droppedParams.some((d) => d.reason === 'forbidden_by_contract')).toBe(true)
  })

  it('resolves conflicts with prefer_first strategy', () => {
    const capability: MediaModelCapabilityManifest = {
      id: 'video.generate',
      label: '文生视频',
      input: { required: ['prompt'] },
      output: { types: ['video'] },
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          durationSeconds: { type: 'integer' },
          frames: { type: 'integer' },
        },
      },
      paramPolicy: {
        conflicts: [{ fields: ['durationSeconds', 'frames'], strategy: 'prefer_first' }],
      },
    }
    const result = compile({
      capability,
      modelParams: { durationSeconds: 8, frames: 200 },
    })
    expect(result.providerParams.durationSeconds).toBe(8)
    expect(result.providerParams).not.toHaveProperty('frames')
    expect(result.droppedParams.some((d) => d.name === 'frames' && d.reason === 'conflict_removed')).toBe(true)
  })

  it('ratio_size_to_aspect transform: size 16:9 -> aspectRatio', () => {
    const capability: MediaModelCapabilityManifest = {
      id: 'image.generate',
      label: '文生图',
      input: { required: ['prompt'] },
      output: { types: ['image'] },
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { aspectRatio: { type: 'string' }, size: { type: 'string' } },
      },
      paramPolicy: {
        transforms: [{ kind: 'ratio_size_to_aspect', from: 'size', to: 'aspectRatio' }],
      },
    }
    const result = compile({
      capability,
      modelParams: { size: '16:9' },
    })
    expect(result.providerParams.aspectRatio).toBe('16:9')
    expect(result.providerParams).not.toHaveProperty('size')
  })

  it('drops passthrough value when allowScalarsOnly=false default rejects non-scalar', () => {
    const result = compile({
      capability: imageCapability({
        paramPolicy: {
          strict: true,
          passthrough: { enabled: true, allow: ['style'] },
        },
      }),
      modelParams: { style: { cinematic: true } },
    })
    expect(result.providerParams).not.toHaveProperty('style')
    expect(result.droppedParams.some((d) => d.name === 'style' && d.reason === 'unsafe_passthrough')).toBe(true)
  })

  it('does not double-count same dropped param', () => {
    const result = compile({
      capability: imageCapability({
        paramPolicy: { strict: true, passthrough: { enabled: false } },
      }),
      modelParams: { foo: 'bar' },
    })
    const fooDrops = result.droppedParams.filter((d) => d.name === 'foo')
    expect(fooDrops).toHaveLength(1)
  })
})
