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
  providerDefaults?: Record<string, unknown>
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
    ...(opts.providerDefaults !== undefined ? { providerDefaults: opts.providerDefaults } : {}),
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

describe('compileMediaRequest — defaults canonical normalization', () => {
  // 回归 H3 类缺陷：capability.defaults 用 provider 原生名（ratio/duration），
  // 用户 raw 经 normalize 后变成 canonical 名（aspectRatio/durationSeconds）。
  // 归一前两套同义键会在 merged 里并存并一起透传给 provider；归一后只保留一组。
  it('regression: provider-native default keys no longer leak alongside canonical user input', () => {
    const capability: MediaModelCapabilityManifest = {
      id: 'video.image_to_video',
      label: '图生视频',
      input: { required: ['prompt'] },
      output: { types: ['video'] },
      // H3 风格：schema 用 provider 原生名，additionalProperties:true → 退化 strict:false passthrough
      paramSchema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          duration: { type: 'integer' },
          ratio: { type: 'string' },
          resolution: { type: 'string' },
        },
      },
      // defaults 故意用 provider 原生名（模拟 H3 历史写法）
      defaults: { duration: 5, ratio: 'adaptive', resolution: '2K' },
    }
    // 用户在 UI 选了 ratio=3:4、duration=10（schema 字段名）
    const result = compile({ capability, modelParams: { ratio: '3:4', duration: 10 } })

    // 归一后 merged 只剩一组键：aspectRatio='3:4'、durationSeconds=10（user 覆盖 defaults 归一值）
    expect(result.providerParams.aspectRatio).toBe('3:4')
    expect(result.providerParams.durationSeconds).toBe(10)
    // 关键断言：defaults 的 provider 原生名（ratio/duration）不再作为同义键泄漏到请求体
    expect(result.providerParams).not.toHaveProperty('ratio')
    expect(result.providerParams).not.toHaveProperty('duration')
  })

  it('normalizes capability defaults so canonical user input overrides cleanly under strict + aliases', () => {
    const capability: MediaModelCapabilityManifest = {
      id: 'video.generate',
      label: '文生视频',
      input: { required: ['prompt'] },
      output: { types: ['video'] },
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          aspectRatio: { type: 'string', enum: ['16:9', '3:4'] },
          durationSeconds: { type: 'integer', minimum: 1, maximum: 60 },
        },
      },
      // defaults 用 provider 原生名，但 schema 声明的是 canonical 名
      defaults: { ratio: '16:9', duration: 5 },
      aliases: { aspectRatio: 'ratio', durationSeconds: 'duration' },
      paramPolicy: { strict: true, passthrough: { enabled: false } },
    }
    const result = compile({ capability, modelParams: { aspectRatio: '3:4', durationSeconds: 10 } })
    // 归一后 defaults.aspectRatio='16:9' 被 user '3:4' 覆盖；aliases 映射回 provider 名
    expect(result.providerParams.ratio).toBe('3:4')
    expect(result.providerParams.duration).toBe(10)
    expect(result.providerParams).not.toHaveProperty('aspectRatio')
    expect(result.providerParams).not.toHaveProperty('durationSeconds')
  })

  it('also normalizes provider-level defaults written in provider-native names', () => {
    const capability: MediaModelCapabilityManifest = {
      id: 'image.generate',
      label: '文生图',
      input: { required: ['prompt'] },
      output: { types: ['image'] },
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          aspectRatio: { type: 'string', enum: ['1:1', '16:9'] },
        },
      },
      aliases: { aspectRatio: 'ratio' },
      paramPolicy: { strict: true, passthrough: { enabled: false } },
    }
    // providerDefaults 用 provider 原生名 ratio（覆盖 capability 无 defaults 的场景）
    const result = compile({
      capability,
      modelParams: { aspectRatio: '16:9' },
      providerDefaults: { ratio: '1:1' },
    })
    // providerDefaults 归一为 aspectRatio='1:1'，再被 user '16:9' 覆盖
    expect(result.providerParams.ratio).toBe('16:9')
    expect(result.providerParams).not.toHaveProperty('aspectRatio')
  })
})
