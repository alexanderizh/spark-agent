import { describe, expect, it } from 'vitest'
import { shouldShowAssistantIdentity } from './chat-message-avatar'

describe('shouldShowAssistantIdentity', () => {
  it('hides the primary agent identity in single-agent mode', () => {
    expect(shouldShowAssistantIdentity(false, 'primary', 'primary')).toBe(false)
  })

  it('keeps a delegated subagent identity in single-agent mode', () => {
    expect(shouldShowAssistantIdentity(false, 'subagent', 'primary')).toBe(true)
  })

  it('keeps agent identities in team mode', () => {
    expect(shouldShowAssistantIdentity(true, 'host', 'host')).toBe(true)
  })
})
