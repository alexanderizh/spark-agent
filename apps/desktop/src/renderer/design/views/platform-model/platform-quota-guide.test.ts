import { describe, expect, it } from 'vitest'
import type { AgentEvent, ProviderProfile } from '@spark/protocol'
import { isManagedPlatformQuotaError } from './platform-quota-guide'

const managedProvider = {
  id: 'spark-platform-newapi',
  managed: true,
} as ProviderProfile

function errorEvent(patch: Partial<Extract<AgentEvent, { type: 'agent_error' }>> = {}) {
  return {
    id: 'event-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: '',
    seq: 1,
    type: 'agent_error',
    code: 'CLAUDE_BILLING_ERROR',
    message: '额度不可用',
    retryable: false,
    ...patch,
  } as Extract<AgentEvent, { type: 'agent_error' }>
}

describe('platform quota guide error matching', () => {
  it('matches billing and insufficient quota errors for the managed provider', () => {
    expect(isManagedPlatformQuotaError(errorEvent(), managedProvider.id, [managedProvider])).toBe(
      true,
    )
    expect(
      isManagedPlatformQuotaError(
        errorEvent({ code: 'SDK_ERROR', rawError: 'HTTP 402 insufficient_quota' }),
        managedProvider.id,
        [managedProvider],
      ),
    ).toBe(true)
  })

  it('does not intercept third-party provider billing errors', () => {
    const thirdParty = { ...managedProvider, id: 'third-party', managed: false }
    expect(isManagedPlatformQuotaError(errorEvent(), thirdParty.id, [thirdParty])).toBe(false)
  })
})
