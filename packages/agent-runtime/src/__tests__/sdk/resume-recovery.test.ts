import { describe, expect, it } from 'vitest'
import { classifyResumeError, ResumeCircuitBreaker, SDK_RESUME_ERROR_PATTERNS } from '../../sdk/types.js'

describe('classifyResumeError', () => {
  it('classifies "session id already in use" as a resume error', () => {
    const result = classifyResumeError(new Error('Session ID already in use'))
    expect(result.isResumeError).toBe(true)
    expect(result.reason).toContain('already')
  })

  it('classifies "session not found" as a resume error', () => {
    const result = classifyResumeError(new Error('Session not found: abc-123'))
    expect(result.isResumeError).toBe(true)
    expect(result.reason).toContain('not')
  })

  it('classifies "session expired" as a resume error', () => {
    const result = classifyResumeError(new Error('Session expired'))
    expect(result.isResumeError).toBe(true)
  })

  it('classifies "failed to resume" as a resume error', () => {
    const result = classifyResumeError(new Error('Failed to resume session'))
    expect(result.isResumeError).toBe(true)
  })

  it('classifies "cannot resume" as a resume error', () => {
    const result = classifyResumeError(new Error('Cannot resume: session invalid'))
    expect(result.isResumeError).toBe(true)
  })

  it('does not classify unrelated errors as resume errors', () => {
    expect(classifyResumeError(new Error('write EPIPE')).isResumeError).toBe(false)
    expect(classifyResumeError(new Error('Network timeout')).isResumeError).toBe(false)
    expect(classifyResumeError(new Error('Rate limit exceeded')).isResumeError).toBe(false)
    expect(classifyResumeError(new Error('ENOTFOUND')).isResumeError).toBe(false)
    expect(classifyResumeError('some string').isResumeError).toBe(false)
  })

  it('covers all defined error patterns', () => {
    const testMessages = [
      'session id already in use',
      'Session not found',
      'Session expired',
      'Session does not exist',
      'Invalid session identifier',
      'Session is no longer available',
      'Failed to resume conversation',
      'Cannot resume, session was terminated',
    ]

    for (const msg of testMessages) {
      const result = classifyResumeError(new Error(msg))
      expect(result.isResumeError, `Expected "${msg}" to be classified as a resume error`).toBe(true)
    }

    // Verify pattern count matches
    expect(SDK_RESUME_ERROR_PATTERNS).toHaveLength(8)
  })
})

describe('ResumeCircuitBreaker', () => {
  it('allows resume when no failures have been recorded', () => {
    const breaker = new ResumeCircuitBreaker()
    expect(breaker.isResumeAllowed('sess-1')).toBe(true)
    expect(breaker.getFailureCount('sess-1')).toBe(0)
  })

  it('opens the circuit after max failures', () => {
    const breaker = new ResumeCircuitBreaker(3)

    expect(breaker.recordFailure('sess-1')).toBe(false) // 1 failure
    expect(breaker.isResumeAllowed('sess-1')).toBe(true)

    expect(breaker.recordFailure('sess-1')).toBe(false) // 2 failures
    expect(breaker.isResumeAllowed('sess-1')).toBe(true)

    expect(breaker.recordFailure('sess-1')).toBe(true) // 3 failures = circuit open
    expect(breaker.isResumeAllowed('sess-1')).toBe(false)
    expect(breaker.getFailureCount('sess-1')).toBe(3)
  })

  it('tracks failures independently per session', () => {
    const breaker = new ResumeCircuitBreaker(2)

    breaker.recordFailure('sess-a')
    breaker.recordFailure('sess-a')
    expect(breaker.isResumeAllowed('sess-a')).toBe(false)

    expect(breaker.isResumeAllowed('sess-b')).toBe(true)
    expect(breaker.getFailureCount('sess-b')).toBe(0)
  })

  it('resets failure count on success', () => {
    const breaker = new ResumeCircuitBreaker(3)

    breaker.recordFailure('sess-1')
    breaker.recordFailure('sess-1')
    expect(breaker.getFailureCount('sess-1')).toBe(2)

    breaker.recordSuccess('sess-1')
    expect(breaker.getFailureCount('sess-1')).toBe(0)
    expect(breaker.isResumeAllowed('sess-1')).toBe(true)
  })

  it('supports resetting a specific session', () => {
    const breaker = new ResumeCircuitBreaker(2)

    breaker.recordFailure('sess-a')
    breaker.recordFailure('sess-b')

    breaker.reset('sess-a')
    expect(breaker.getFailureCount('sess-a')).toBe(0)
    expect(breaker.getFailureCount('sess-b')).toBe(1)
  })

  it('supports resetting all sessions', () => {
    const breaker = new ResumeCircuitBreaker(2)

    breaker.recordFailure('sess-a')
    breaker.recordFailure('sess-b')

    breaker.reset()
    expect(breaker.getFailureCount('sess-a')).toBe(0)
    expect(breaker.getFailureCount('sess-b')).toBe(0)
  })

  it('uses default max failures of 3', () => {
    const breaker = new ResumeCircuitBreaker()

    breaker.recordFailure('sess-1')
    breaker.recordFailure('sess-1')
    expect(breaker.isResumeAllowed('sess-1')).toBe(true)

    breaker.recordFailure('sess-1')
    expect(breaker.isResumeAllowed('sess-1')).toBe(false)
  })
})
