import { describe, expect, it } from 'vitest'
import {
  CanvasTextOutputCapabilityCache,
  classifyCanvasTextOutputLimitError,
  nextCanvasTextOutputRetryMax,
  type CanvasTextOutputCapabilityKey,
} from './canvasTextOutputCapability.js'

function createSettings() {
  const values = new Map<string, unknown>()
  return {
    get(category: string, key: string) {
      return values.get(`${category}:${key}`) ?? null
    },
    set(category: string, key: string, value: unknown) {
      values.set(`${category}:${key}`, value)
    },
  }
}

const key = (overrides: Partial<CanvasTextOutputCapabilityKey> = {}) => ({
  providerProfileId: 'provider-1',
  endpoint: 'https://newapi.example/v1/',
  model: 'deepseek-v4-pro',
  apiKind: 'chat' as const,
  ...overrides,
})

describe('canvasTextOutputCapability', () => {
  it('extracts an exact limit from a nested NewAPI provider error', () => {
    expect(
      classifyCanvasTextOutputLimitError({
        statusCode: 400,
        responseBody: JSON.stringify({
          error: {
            type: 'InvalidParameter',
            message:
              "The parameter 'max_tokens' is not valid: expected a value <= 128000, but got 170000 instead.",
          },
        }),
      }),
    ).toMatchObject({
      kind: 'output_limit',
      exactLimit: 128_000,
    })
  })

  it('recognizes output-limit errors without assuming a numeric format', () => {
    expect(
      classifyCanvasTextOutputLimitError({
        statusCode: 400,
        responseBody: '{"error":{"message":"max_output_tokens is too large"}}',
      }),
    ).toMatchObject({ kind: 'output_limit' })

    expect(
      classifyCanvasTextOutputLimitError({
        statusCode: 422,
        responseBody: 'max_completion_tokens exceeds the supported maximum',
      }),
    ).toMatchObject({ kind: 'output_limit' })
  })

  it('combines structured param and message fields during classification', () => {
    expect(
      classifyCanvasTextOutputLimitError({
        param: 'max_tokens',
        code: 'invalid_parameter',
        message: 'expected a value <= 8192',
      }),
    ).toMatchObject({ kind: 'output_limit', exactLimit: 8_192 })
  })

  it('does not retry unrelated HTTP 400 responses', () => {
    expect(
      classifyCanvasTextOutputLimitError({
        statusCode: 400,
        responseBody: '{"error":{"message":"invalid image input"}}',
      }),
    ).toEqual({ kind: 'other' })
  })

  it('uses a strictly descending retry ladder', () => {
    expect(nextCanvasTextOutputRetryMax(131_072)).toBe(65_536)
    expect(nextCanvasTextOutputRetryMax(65_536)).toBe(32_768)
    expect(nextCanvasTextOutputRetryMax(16_384)).toBe(8_192)
    expect(nextCanvasTextOutputRetryMax(5_000)).toBe(4_096)
    expect(nextCanvasTextOutputRetryMax(4_096)).toBeUndefined()
  })

  it('persists the lowest observed safe cap for seven days', () => {
    const settings = createSettings()
    let now = Date.UTC(2026, 6, 18)
    const cache = new CanvasTextOutputCapabilityCache(settings, () => now)

    cache.record(key(), 32_768, 'successful_downgrade')
    expect(cache.get(key())).toBe(32_768)
    expect(new CanvasTextOutputCapabilityCache(settings, () => now).get(key())).toBe(32_768)

    cache.record(key(), 65_536, 'successful_downgrade')
    expect(cache.get(key())).toBe(32_768)

    cache.record(key(), 16_384, 'exact_error_limit')
    expect(cache.get(key())).toBe(16_384)

    now += 7 * 24 * 60 * 60 * 1_000 + 1
    expect(cache.get(key())).toBeUndefined()
  })

  it('normalizes endpoint identity and clears only one provider', () => {
    const settings = createSettings()
    const cache = new CanvasTextOutputCapabilityCache(settings)

    cache.record(key(), 32_768, 'successful_downgrade')
    expect(cache.get(key({ endpoint: 'https://newapi.example/v1' }))).toBe(32_768)
    cache.record(key({ model: 'glm-5.2' }), 16_384, 'exact_error_limit')
    cache.record(key({ providerProfileId: 'provider-2' }), 65_536, 'successful_downgrade')

    cache.clearProvider('provider-1')

    expect(cache.get(key())).toBeUndefined()
    expect(cache.get(key({ model: 'glm-5.2' }))).toBeUndefined()
    expect(cache.get(key({ providerProfileId: 'provider-2' }))).toBe(65_536)
  })
})
