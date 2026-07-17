import { describe, expect, it } from 'vitest'
import {
  CanvasTextAdaptiveGenerationError,
  generateCanvasTextWithAdaptiveOutput,
} from './canvasTextAdaptiveGeneration.js'

function outputLimitError(message: string) {
  return {
    statusCode: 400,
    responseBody: JSON.stringify({ error: { message } }),
  }
}

describe('generateCanvasTextWithAdaptiveOutput', () => {
  it('downgrades to the next tier when the provider omits the exact limit', async () => {
    const attempts: number[] = []
    const learned: Array<[number, string]> = []

    const result = await generateCanvasTextWithAdaptiveOutput({
      initialMaxTokens: 65_536,
      generate: async (maxTokens) => {
        attempts.push(maxTokens)
        if (attempts.length === 1) {
          throw outputLimitError('max_output_tokens exceeds the supported maximum')
        }
        return { text: 'ok' }
      },
      onLearnedSafeMaxTokens: (value, source) => learned.push([value, source]),
    })

    expect(attempts).toEqual([65_536, 32_768])
    expect(result.value).toEqual({ text: 'ok' })
    expect(result.retryDiagnostics).toMatchObject({ retryCount: 1, attempts })
    expect(result.learnedSafeMaxTokens).toBe(32_768)
    expect(learned).toEqual([[32_768, 'successful_downgrade']])
  })

  it('uses and learns an exact provider limit in one retry', async () => {
    const attempts: number[] = []
    const learned: Array<[number, string]> = []

    await generateCanvasTextWithAdaptiveOutput({
      initialMaxTokens: 170_000,
      generate: async (maxTokens) => {
        attempts.push(maxTokens)
        if (attempts.length === 1) {
          throw outputLimitError('max_tokens expected a value <= 128000, but got 170000')
        }
        return 'ok'
      },
      onLearnedSafeMaxTokens: (value, source) => learned.push([value, source]),
    })

    expect(attempts).toEqual([170_000, 128_000])
    expect(learned[0]).toEqual([128_000, 'exact_error_limit'])
  })

  it('does not trust an extracted limit that is not below the failed attempt', async () => {
    const attempts: number[] = []

    await generateCanvasTextWithAdaptiveOutput({
      initialMaxTokens: 65_536,
      generate: async (maxTokens) => {
        attempts.push(maxTokens)
        if (attempts.length === 1) {
          throw outputLimitError('max_tokens expected a value <= 128000')
        }
        return 'ok'
      },
    })

    expect(attempts).toEqual([65_536, 32_768])
  })

  it('immediately rethrows unrelated provider failures', async () => {
    const error = { statusCode: 400, responseBody: '{"error":{"message":"invalid image"}}' }
    const attempts: number[] = []

    await expect(generateCanvasTextWithAdaptiveOutput({
      initialMaxTokens: 65_536,
      generate: async (maxTokens) => {
        attempts.push(maxTokens)
        throw error
      },
    })).rejects.toBe(error)
    expect(attempts).toEqual([65_536])
  })

  it('bounds retries at the bottom of the downgrade ladder', async () => {
    const error = outputLimitError('max_tokens is above the maximum')
    const attempts: number[] = []

    const assertion = expect(generateCanvasTextWithAdaptiveOutput({
      initialMaxTokens: 131_072,
      generate: async (maxTokens) => {
        attempts.push(maxTokens)
        throw error
      },
    })).rejects.toMatchObject({
      name: 'CanvasTextAdaptiveGenerationError',
      cause: error,
      retryDiagnostics: {
        retryCount: 5,
        attempts: [131_072, 65_536, 32_768, 16_384, 8_192, 4_096],
      },
    } satisfies Partial<CanvasTextAdaptiveGenerationError>)
    await assertion

    expect(attempts).toEqual([131_072, 65_536, 32_768, 16_384, 8_192, 4_096])
  })
})
