import {
  classifyCanvasTextOutputLimitError,
  nextCanvasTextOutputRetryMax,
} from './canvasTextOutputCapability.js'

export type CanvasTextOutputLimitRetryDiagnostics = {
  retryCount: number
  attempts: number[]
  evidence?: string | undefined
}

export class CanvasTextAdaptiveGenerationError extends Error {
  override readonly cause: unknown
  readonly retryDiagnostics: CanvasTextOutputLimitRetryDiagnostics

  constructor(cause: unknown, retryDiagnostics: CanvasTextOutputLimitRetryDiagnostics) {
    super(cause instanceof Error ? cause.message : '模型拒绝了画布文本输出上限')
    this.name = 'CanvasTextAdaptiveGenerationError'
    this.cause = cause
    this.retryDiagnostics = retryDiagnostics
  }
}

export async function generateCanvasTextWithAdaptiveOutput<T>(input: {
  initialMaxTokens: number
  generate: (maxTokens: number) => Promise<T>
  onLearnedSafeMaxTokens?: (
    value: number,
    source: 'exact_error_limit' | 'successful_downgrade',
  ) => void
  maxRetries?: number
}): Promise<{
  value: T
  learnedSafeMaxTokens?: number
  retryDiagnostics: CanvasTextOutputLimitRetryDiagnostics
}> {
  const maxRetries = Math.max(0, Math.floor(input.maxRetries ?? 5))
  const attempts: number[] = []
  let currentMaxTokens = Math.max(1, Math.floor(input.initialMaxTokens))
  let retryCount = 0
  let evidence: string | undefined
  let exactLearnedLimit: number | undefined

  while (true) {
    attempts.push(currentMaxTokens)
    try {
      const value = await input.generate(currentMaxTokens)
      const learnedSafeMaxTokens = retryCount > 0 ? currentMaxTokens : undefined
      if (learnedSafeMaxTokens != null && exactLearnedLimit == null) {
        input.onLearnedSafeMaxTokens?.(learnedSafeMaxTokens, 'successful_downgrade')
      }
      return {
        value,
        ...(learnedSafeMaxTokens != null ? { learnedSafeMaxTokens } : {}),
        retryDiagnostics: {
          retryCount,
          attempts,
          ...(evidence ? { evidence } : {}),
        },
      }
    } catch (error) {
      const classified = classifyCanvasTextOutputLimitError(error)
      if (classified.kind === 'other') throw error
      evidence = classified.evidence
      if (retryCount >= maxRetries) {
        throw new CanvasTextAdaptiveGenerationError(error, {
          retryCount,
          attempts,
          evidence,
        })
      }

      const exactLimit = classified.exactLimit
      const nextMaxTokens = exactLimit != null && exactLimit > 0 && exactLimit < currentMaxTokens
        ? exactLimit
        : nextCanvasTextOutputRetryMax(currentMaxTokens)
      if (nextMaxTokens == null || nextMaxTokens >= currentMaxTokens) {
        throw new CanvasTextAdaptiveGenerationError(error, {
          retryCount,
          attempts,
          evidence,
        })
      }

      if (exactLimit === nextMaxTokens) {
        exactLearnedLimit = exactLimit
        input.onLearnedSafeMaxTokens?.(exactLimit, 'exact_error_limit')
      }
      currentMaxTokens = nextMaxTokens
      retryCount += 1
    }
  }
}
