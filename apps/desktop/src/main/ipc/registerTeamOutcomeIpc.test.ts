import { describe, expect, it, vi } from 'vitest'
import { registerTeamOutcomeIpc } from './registerTeamOutcomeIpc.js'

describe('registerTeamOutcomeIpc', () => {
  it('registers the P2 Team IPC handlers once in a stable order', () => {
    const calls: string[] = []
    registerTeamOutcomeIpc({
      registerRuntime: vi.fn(() => calls.push('runtime')),
      registerEvidenceCost: vi.fn(() => calls.push('evidence-cost')),
      registerReplayPlaybook: vi.fn(() => calls.push('replay-playbook')),
    })
    expect(calls).toEqual(['runtime', 'evidence-cost', 'replay-playbook'])
  })
})
