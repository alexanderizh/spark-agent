import { describe, expect, it } from 'vitest'
import type { MediaErrorContract } from '@spark/protocol'
import { normalizeMediaError } from '../../../services/media/media-error-normalizer.js'
import { fetchJson } from '../../../services/media/media-http.util.js'
import { MediaProviderError } from '../../../services/media/media-adapter.types.js'

function makeFetch(response: { status: number; body: unknown }): typeof fetch {
  return async (_input: string | URL | Request, _init?: RequestInit) => {
    const text = typeof response.body === 'string' ? response.body : JSON.stringify(response.body)
    return new Response(text, {
      status: response.status,
      headers: { 'content-type': typeof response.body === 'string' ? 'text/plain' : 'application/json' },
    })
  }
}

const volcContract: MediaErrorContract = {
  codePaths: ['error.code'],
  messagePaths: ['error.message'],
  requestIdPaths: ['RequestId', 'request_id'],
  paramNamePatterns: ['parameter `([a-z_]+)`'],
  mappings: {
    InvalidParameter: 'unsupported_parameter',
    Unauthorized: 'auth_failed',
  },
  retryableCodes: ['Throttling'],
}

const openaiContract: MediaErrorContract = {
  codePaths: ['error.code', 'error.type'],
  messagePaths: ['error.message'],
  paramNamePaths: ['error.param'],
  requestIdPaths: ['request_id'],
  mappings: {
    invalid_api_key: 'auth_failed',
    rate_limit_exceeded: 'rate_limited',
  },
}

const xaiContract: MediaErrorContract = {
  codePaths: ['error.type'],
  messagePaths: ['error.message'],
  paramNamePatterns: ['parameter `([a-z_]+)`'],
}

const googleContract: MediaErrorContract = {
  codePaths: ['error.code'],
  messagePaths: ['error.message'],
  requestIdPaths: ['error.details.0.request_id'],
  mappings: {
    INVALID_ARGUMENT: 'invalid_parameter_value',
    PERMISSION_DENIED: 'auth_failed',
  },
}

describe('normalizeMediaError — provider fixtures', () => {
  it('volcengine/ark style: extracts code/message/requestId/paramName and maps InvalidParameter', () => {
    const result = normalizeMediaError({
      statusCode: 400,
      body: {
        error: {
          code: 'InvalidParameter',
          message: "The parameter `output_format` specified in the request is not valid: the parameter `output_format` is not supported by the current model.",
        },
        request_id: '021783234719056d323cdad39964ab14a5fcc08ad1c36506f5fb0',
      },
      rawText: '',
      contract: volcContract,
    })
    expect(result.code).toBe('unsupported_parameter')
    expect(result.providerCode).toBe('InvalidParameter')
    expect(result.paramName).toBe('output_format')
    expect(result.requestId).toBe('021783234719056d323cdad39964ab14a5fcc08ad1c36506f5fb0')
    expect(result.message).toContain('output_format')
  })

  it('openai-compatible style: extracts error.type and error.param', () => {
    const result = normalizeMediaError({
      statusCode: 400,
      body: {
        error: {
          type: 'invalid_request_error',
          code: 'invalid_parameter',
          message: 'output_format is not supported by this model',
          param: 'output_format',
        },
      },
      rawText: '',
      contract: openaiContract,
    })
    expect(result.code).toBe('unsupported_parameter')
    // codePaths 顺序：error.code 优先于 error.type，命中 'invalid_parameter'。
    expect(result.providerCode).toBe('invalid_parameter')
    expect(result.paramName).toBe('output_format')
  })

  it('xAI style: error.type + message-based paramName extraction', () => {
    const result = normalizeMediaError({
      statusCode: 400,
      body: {
        error: {
          type: 'invalid_request_error',
          message: 'Unsupported parameter: `output_format` is not supported by current model.',
        },
      },
      rawText: '',
      contract: xaiContract,
    })
    expect(result.code).toBe('unsupported_parameter')
    expect(result.providerCode).toBe('invalid_request_error')
    expect(result.paramName).toBe('output_format')
  })

  it('google style: error.code + mapping', () => {
    const result = normalizeMediaError({
      statusCode: 400,
      body: {
        error: {
          code: 400,
          message: 'Invalid output_format value',
          status: 'INVALID_ARGUMENT',
          details: [{ request_id: 'google-req-123' }],
        },
      },
      rawText: '',
      contract: googleContract,
    })
    expect(result.code).toBe('invalid_parameter_value')
    expect(result.providerCode).toBe('INVALID_ARGUMENT')
    expect(result.requestId).toBe('google-req-123')
  })

  it('non-JSON error text: falls back to HTTP status', () => {
    const result = normalizeMediaError({
      statusCode: 500,
      body: 'Internal Server Error',
      rawText: 'Internal Server Error',
    })
    expect(result.code).toBe('provider_http_error')
    expect(result.message).toContain('500')
  })

  it('401 → auth_failed', () => {
    const result = normalizeMediaError({
      statusCode: 401,
      body: { error: { message: 'Unauthorized' } },
      rawText: '',
    })
    expect(result.code).toBe('auth_failed')
  })

  it('429 → rate_limited + retryable', () => {
    const result = normalizeMediaError({
      statusCode: 429,
      body: { error: { message: 'Too many requests' } },
      rawText: '',
    })
    expect(result.code).toBe('rate_limited')
    expect(result.retryable).toBe(true)
  })

  it('quota exceeded via message keyword', () => {
    const result = normalizeMediaError({
      statusCode: 400,
      body: { error: { message: 'Your quota has been exhausted. Add billing to continue.' } },
      rawText: '',
    })
    expect(result.code).toBe('quota_exceeded')
  })

  it('retryableCodes marks Throttling retryable even when mapping falls back', () => {
    const result = normalizeMediaError({
      statusCode: 429,
      body: { error: { code: 'Throttling', message: 'slow down' } },
      rawText: '',
      contract: volcContract,
    })
    expect(result.retryable).toBe(true)
    expect(result.providerCode).toBe('Throttling')
  })

  it('rawSnippet is truncated to safe length', () => {
    const hugeBody = { error: { message: 'x'.repeat(2000) } }
    const result = normalizeMediaError({
      statusCode: 500,
      body: hugeBody,
      rawText: JSON.stringify(hugeBody),
    })
    expect(result.rawSnippet?.length).toBeLessThanOrEqual(803)
    expect(result.rawSnippet?.endsWith('...')).toBe(true)
  })

  it('case-insensitive RequestId lookup (volcengine uppercase)', () => {
    const result = normalizeMediaError({
      statusCode: 400,
      body: { RequestId: 'REQ-CASE-123', error: { code: 'X', message: 'fail' } },
      rawText: '',
      contract: volcContract,
    })
    expect(result.requestId).toBe('REQ-CASE-123')
  })
})

describe('fetchJson integration with errorContract', () => {
  it('attaches normalized error to MediaProviderError on 400 + volcengine contract', async () => {
    const body = {
      error: {
        code: 'InvalidParameter',
        message: "The parameter `output_format` is not supported by the current model.",
      },
      request_id: 'req-fetch-1',
    }
    let caught: MediaProviderError | null = null
    try {
      await fetchJson('https://example/v1/images', {
        method: 'POST',
        body: '{}',
        fetchImpl: makeFetch({ status: 400, body }),
        errorContract: volcContract,
      })
    } catch (e) {
      caught = e instanceof MediaProviderError ? e : null
    }
    expect(caught).toBeInstanceOf(MediaProviderError)
    expect(caught?.normalized?.code).toBe('unsupported_parameter')
    expect(caught?.normalized?.paramName).toBe('output_format')
    expect(caught?.normalized?.requestId).toBe('req-fetch-1')
  })

  it('does not attach normalized when errorContract absent (legacy behavior)', async () => {
    let caught: MediaProviderError | null = null
    try {
      await fetchJson('https://example/v1/images', {
        method: 'POST',
        body: '{}',
        fetchImpl: makeFetch({ status: 500, body: { error: 'oops' } }),
      })
    } catch (e) {
      caught = e instanceof MediaProviderError ? e : null
    }
    expect(caught).toBeInstanceOf(MediaProviderError)
    expect(caught?.normalized).toBeUndefined()
  })
})
