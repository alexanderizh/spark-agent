/**
 * 内置 manifest Contract V2 收紧快照测试。
 *
 * 每个 high-priority manifest（xAI image / Seedream 5 lite / Seedream 5 主 /
 * Google image / APIMart GPT-Image）都在这里跑一组编译器快照，验证：
 *   - 已声明的 canonical 参数能正常进入 providerParams（aliases 已映射）。
 *   - 显式 forbidden 字段会被丢弃并产 forbidden_by_contract dropped。
 *   - ratio_size_to_aspect 等 transform 被正确触发。
 *   - error contract 能解析 provider 错误响应（火山 InvalidParameter / xAI error.type）。
 *
 * 与 media-request-compiler.test.ts 的关系：
 *   - compiler 测试覆盖通用管线（任意 manifest 的行为）。
 *   - 本文件覆盖**内置 manifest** 的 contract 实际声明，避免后续误删 paramPolicy/error。
 */

import { describe, expect, it } from 'vitest'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '@spark/protocol'
import type {
  MediaErrorContract,
  MediaModelCapabilityManifest,
  MediaModelManifest,
} from '@spark/protocol'
import { compileMediaRequest } from '../../../services/media/media-request-compiler.js'
import { normalizeMediaError } from '../../../services/media/media-error-normalizer.js'

function findManifest(id: string): MediaModelManifest {
  const m = BUILTIN_MEDIA_MODEL_MANIFESTS.find((x) => x.id === id)
  if (!m) throw new Error(`manifest ${id} not found`)
  return m
}

function findCapability(manifest: MediaModelManifest, id: string): MediaModelCapabilityManifest {
  const c = manifest.capabilities.find((x) => x.id === id)
  if (!c) throw new Error(`capability ${id} not found in ${manifest.id}`)
  return c
}

function compileFromManifest(manifestId: string, capabilityId: string, modelParams: Record<string, unknown>) {
  const manifest = findManifest(manifestId)
  const capability = findCapability(manifest, capabilityId)
  return compileMediaRequest({
    manifest,
    capability,
    modelId: manifest.modelId,
    input: { modelParams },
    mode: 'adapter',
  })
}

describe('M5 builtin manifest contract — xAI image', () => {
  const manifestId = 'xai:grok-imagine-image'

  it('declares paramPolicy (strict + size forbidden + ratio_size_to_aspect transform)', () => {
    const manifest = findManifest(manifestId)
    const cap = findCapability(manifest, 'image.generate')
    expect(cap.paramPolicy).toBeDefined()
    expect(cap.paramPolicy?.strict).toBe(true)
    expect(cap.paramPolicy?.passthrough?.enabled).toBe(false)
    expect(cap.paramPolicy?.transforms).toEqual([{ kind: 'ratio_size_to_aspect', from: 'size', to: 'aspectRatio' }])
    expect(cap.paramPolicy?.forbidden?.map((f) => f.name)).toContain('size')
  })

  it('declares error contract on manifest root', () => {
    const manifest = findManifest(manifestId)
    expect(manifest.error).toBeDefined()
    expect(manifest.error?.codePaths).toContain('error.code')
    expect(manifest.error?.paramNamePaths).toContain('error.param')
  })

  it('aspectRatio canonical -> provider aspect_ratio alias', () => {
    const result = compileFromManifest(manifestId, 'image.generate', { aspectRatio: '16:9' })
    expect(result.providerParams.aspect_ratio).toBe('16:9')
    expect(result.providerParams).not.toHaveProperty('aspectRatio')
  })

  it('size "16:9" is transformed into aspectRatio -> aspect_ratio (no provider 400)', () => {
    const result = compileFromManifest(manifestId, 'image.generate', { size: '16:9' })
    expect(result.providerParams.aspect_ratio).toBe('16:9')
    expect(result.providerParams).not.toHaveProperty('size')
  })

  it('non-ratio size value (e.g. "1024x1024") is forbidden-dropped', () => {
    const result = compileFromManifest(manifestId, 'image.generate', { size: '1024x1024' })
    expect(result.providerParams).not.toHaveProperty('size')
    expect(result.providerParams).not.toHaveProperty('aspect_ratio')
    expect(result.droppedParams.some((d) => d.name === 'size' && d.reason === 'forbidden_by_contract')).toBe(true)
  })

  it('drops unknown params (filename / debug) under strict policy', () => {
    const result = compileFromManifest(manifestId, 'image.generate', { filename: 'out.png', debug: 1 })
    expect(result.providerParams).not.toHaveProperty('filename')
    expect(result.providerParams).not.toHaveProperty('debug')
  })

  it('normalizes xAI error.response (error.type=invalid_request_error + error.param) to unsupported_parameter-ish', () => {
    const manifest = findManifest(manifestId)
    const contract = manifest.error as MediaErrorContract
    const result = normalizeMediaError({
      statusCode: 400,
      body: {
        error: {
          type: 'invalid_request_error',
          message: 'Unsupported parameter: `size` is not supported by current model.',
          param: 'size',
        },
      },
      rawText: '',
      contract,
    })
    expect(result.providerCode).toBe('invalid_request_error')
    expect(result.paramName).toBe('size')
    expect(result.retryable).toBe(false)
  })
})

describe('M5 builtin manifest contract — Seedream 5 lite', () => {
  const manifestId = 'volcengine:doubao-seedream-5-0-lite-260128'

  it('declares volcengine error contract on manifest root', () => {
    const manifest = findManifest(manifestId)
    expect(manifest.error).toBeDefined()
    expect(manifest.error?.codePaths).toContain('error.code')
    expect(manifest.error?.requestIdPaths).toContain('request_id')
  })

  it('canonical params (outputFormat, watermark, searchEnabled) survive strict compile', () => {
    const result = compileFromManifest(manifestId, 'image.generate', {
      outputFormat: 'jpeg',
      watermark: true,
      searchEnabled: true,
    })
    expect(result.providerParams.output_format).toBe('jpeg')
    expect(result.providerParams.watermark).toBe(true)
    expect(result.providerParams.enable_search).toBe(true)
  })

  it('normalizes volcengine InvalidParameter + output_format to unsupported_parameter', () => {
    const manifest = findManifest(manifestId)
    const contract = manifest.error as MediaErrorContract
    const result = normalizeMediaError({
      statusCode: 400,
      body: {
        error: {
          code: 'InvalidParameter',
          message: "The parameter `output_format` specified in the request is not valid.",
        },
        request_id: '0217832-test',
      },
      rawText: '',
      contract,
    })
    expect(result.code).toBe('unsupported_parameter')
    expect(result.providerCode).toBe('InvalidParameter')
    expect(result.paramName).toBe('output_format')
    expect(result.requestId).toBe('0217832-test')
  })
})

describe('M5 builtin manifest contract — Seedream 5 主模型', () => {
  const manifestId = 'volcengine:doubao-seedream-5-0-260128'

  it('forbids searchEnabled (主模型不支持联网搜索)', () => {
    const manifest = findManifest(manifestId)
    const cap = findCapability(manifest, 'image.generate')
    expect(cap.paramPolicy?.forbidden?.some((f) => f.name === 'searchEnabled')).toBe(true)
  })

  it('drops searchEnabled with forbidden_by_contract reason', () => {
    const result = compileFromManifest(manifestId, 'image.generate', {
      outputFormat: 'png',
      searchEnabled: true,
    })
    expect(result.providerParams).not.toHaveProperty('enable_search')
    expect(result.providerParams).not.toHaveProperty('searchEnabled')
    expect(result.droppedParams.some((d) => d.name === 'searchEnabled' && d.reason === 'forbidden_by_contract')).toBe(true)
  })
})

describe('M5 builtin manifest contract — Google Gemini image', () => {
  const manifestId = 'google:gemini-3-pro-image'

  it('declares strict paramPolicy on each capability', () => {
    const manifest = findManifest(manifestId)
    const cap = findCapability(manifest, 'image.generate')
    expect(cap.paramPolicy?.strict).toBe(true)
    expect(cap.paramPolicy?.passthrough?.enabled).toBe(false)
  })

  it('declares Google error contract on manifest root', () => {
    const manifest = findManifest(manifestId)
    expect(manifest.error).toBeDefined()
    expect(manifest.error?.codePaths).toContain('error.status')
  })

  it('canonical outputFormat -> provider output_format alias is preserved', () => {
    const result = compileFromManifest(manifestId, 'image.generate', { outputFormat: 'jpeg' })
    expect(result.providerParams.output_format).toBe('jpeg')
  })

  it('drops unknown params (e.g. style, debug) under strict policy', () => {
    const result = compileFromManifest(manifestId, 'image.generate', { style: 'cinematic', debug: 1 })
    expect(result.providerParams).not.toHaveProperty('style')
    expect(result.providerParams).not.toHaveProperty('debug')
    expect(result.droppedParams.some((d) => d.name === 'style')).toBe(true)
  })

  it('normalizes Google INVALID_ARGUMENT to invalid_parameter_value', () => {
    const manifest = findManifest(manifestId)
    const contract = manifest.error as MediaErrorContract
    const result = normalizeMediaError({
      statusCode: 400,
      body: {
        error: {
          code: 400,
          message: 'Invalid value at `output_format`.',
          status: 'INVALID_ARGUMENT',
        },
      },
      rawText: '',
      contract,
    })
    expect(result.code).toBe('invalid_parameter_value')
    expect(result.providerCode).toBe('INVALID_ARGUMENT')
  })
})

describe('M5 builtin manifest contract — APIMart GPT-Image 2', () => {
  const manifestId = 'apimart:gpt-image-2'

  it('declares passthrough allow whitelist (聚合平台保留有限透传)', () => {
    const manifest = findManifest(manifestId)
    const cap = findCapability(manifest, 'image.generate')
    expect(cap.paramPolicy?.passthrough?.enabled).toBe(true)
    expect(cap.paramPolicy?.passthrough?.allow?.length).toBeGreaterThan(0)
    expect(cap.paramPolicy?.passthrough?.deny).toContain('filename')
  })

  it('declares APIMart error contract on manifest root', () => {
    const manifest = findManifest(manifestId)
    expect(manifest.error).toBeDefined()
    expect(manifest.error?.codePaths).toContain('error.code')
  })

  it('allows whitelisted canonical params (aspectRatio, outputFormat)', () => {
    const result = compileFromManifest(manifestId, 'image.generate', {
      aspectRatio: '1:1',
      outputFormat: 'png',
    })
    expect(result.providerParams.aspect_ratio).toBe('1:1')
    expect(result.providerParams.output_format).toBe('png')
  })

  it('drops unknown params not in passthrough allow (e.g. debug)', () => {
    const result = compileFromManifest(manifestId, 'image.generate', { debug: 1, style: 'cinematic' })
    expect(result.providerParams).not.toHaveProperty('debug')
    expect(result.providerParams).not.toHaveProperty('style')
  })

  it('rejects non-scalar passthrough even if whitelisted (allowScalarsOnly=true default)', () => {
    const result = compileFromManifest(manifestId, 'image.generate', { aspectRatio: { width: 1024 } })
    expect(result.droppedParams.some((d) => d.name === 'aspectRatio' && d.reason === 'unsafe_passthrough')).toBe(true)
  })
})
