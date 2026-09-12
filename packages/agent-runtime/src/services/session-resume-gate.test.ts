import { describe, expect, it } from 'vitest'
import { makeSdkRuntimeSessionId } from './session-resume-gate.js'

describe('SDK runtime session identity baseline', () => {
  it('keeps stable and turn-scoped vectors byte-for-byte unchanged', () => {
    expect(
      makeSdkRuntimeSessionId(
        'session-baseline',
        'provider-baseline',
        'claude-sonnet-4-5',
        'claude-sdk',
      ),
    ).toBe('42c23684-7de6-46f9-82c4-d124665f9041')

    expect(
      makeSdkRuntimeSessionId(
        'session-baseline',
        'provider-baseline',
        'claude-sonnet-4-5',
        'claude-sdk',
        'turn-baseline',
      ),
    ).toBe('8f94ce29-2743-4187-8624-04c81a518e72')
  })
})
