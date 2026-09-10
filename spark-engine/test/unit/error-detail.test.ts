import { describe, expect, it } from 'vitest'

import {
  safeDiagnosticText,
  safeDiagnosticValue,
  safeErrorCause,
  safeProviderError,
} from '../../src/llm/error-detail.js'

describe('safe LLM error details', () => {
  it('removes terminal controls and bounds external messages', () => {
    expect(safeDiagnosticText('reset\n\u001b[31mboom', 12)).toBe('reset [31mb…')
  })

  it('keeps diagnostic fields while dropping arbitrary provider payloads', () => {
    expect(
      safeProviderError({
        type: 'bridge_stream_error',
        message: 'socket reset',
        cause: { code: 'ECONNRESET', message: 'peer closed' },
        authorization: 'Bearer provider-secret',
        request: { prompt: 'private input' },
      }),
    ).toEqual({
      type: 'bridge_stream_error',
      message: 'socket reset',
      cause: { code: 'ECONNRESET', message: 'peer closed' },
    })
  })

  it('redacts secret-shaped keys and tolerates cyclic diagnostics', () => {
    const detail: Record<string, unknown> = {
      access_token: 'secret',
      outputTokens: 42,
    }
    detail.cycle = detail
    expect(safeDiagnosticValue(detail)).toEqual({
      access_token: '[redacted]',
      outputTokens: 42,
      cycle: '[circular]',
    })
  })

  it('keeps bounded nested transport causes without serializing the whole error', () => {
    const error = new TypeError('terminated', {
      cause: Object.assign(new Error('socket reset'), { code: 'ECONNRESET', secret: 'drop-me' }),
    })
    expect(safeErrorCause(error)).toEqual({
      name: 'TypeError',
      message: 'terminated',
      cause: { name: 'Error', message: 'socket reset', code: 'ECONNRESET' },
    })
  })
})
