import { describe, expect, it } from 'vitest'
import {
  isComposerSessionWorking,
  resolveComposerRunningAgentIds,
} from '../design/services/composer-working-state'

describe('composer working state', () => {
  it('uses the session running status as the composer working source of truth', () => {
    expect(isComposerSessionWorking('running')).toBe(true)
    expect(isComposerSessionWorking('idle')).toBe(false)
    expect(isComposerSessionWorking('error')).toBe(false)
    expect(isComposerSessionWorking(undefined)).toBe(false)
  })

  it('keeps a running team session tagged with the host when no member block is active', () => {
    expect(
      resolveComposerRunningAgentIds({
        teamEnabled: true,
        runningAgentIds: [],
        isWorking: true,
        fallbackAgentId: 'host-agent',
      }),
    ).toEqual(['host-agent'])
  })

  it('prefers parsed running agents and deduplicates them', () => {
    expect(
      resolveComposerRunningAgentIds({
        teamEnabled: true,
        runningAgentIds: ['member-a', 'member-a', 'member-b'],
        isWorking: true,
        fallbackAgentId: 'host-agent',
      }),
    ).toEqual(['member-a', 'member-b'])
  })

  it('does not show team running tags outside team mode', () => {
    expect(
      resolveComposerRunningAgentIds({
        teamEnabled: false,
        runningAgentIds: ['member-a'],
        isWorking: true,
        fallbackAgentId: 'host-agent',
      }),
    ).toEqual([])
  })
})
