import { describe, expect, it } from 'vitest'
import { shouldShowCapabilityPrompt } from './startupPromptPolicy'

describe('optional capability startup prompt policy', () => {
  const now = Date.parse('2026-08-02T00:00:00.000Z')

  it('prompts only when compatible remote capabilities are missing', () => {
    expect(
      shouldShowCapabilityPrompt(
        {
          capabilities: [
            {
              id: 'office-viewer',
              displayName: 'Office',
              description: 'Office',
              state: 'missing',
              installedVersion: null,
              targetVersion: '2.2.3-1',
              downloadSize: 10,
              installedSize: null,
              autoUpdate: true,
            },
          ],
          checkedAt: new Date(now).toISOString(),
          manifestUpdatedAt: '2026-08-02',
          remoteAvailable: true,
        },
        null,
        now,
      ),
    ).toBe(true)
  })

  it('does not prompt offline or during the seven-day cooldown', () => {
    const snapshot = {
      capabilities: [],
      checkedAt: new Date(now).toISOString(),
      manifestUpdatedAt: '2026-08-02',
      remoteAvailable: false,
    }
    expect(shouldShowCapabilityPrompt(snapshot, null, now)).toBe(false)
    expect(
      shouldShowCapabilityPrompt(
        { ...snapshot, remoteAvailable: true, capabilities: [{ id: 'office-viewer', displayName: 'Office', description: 'Office', state: 'missing', installedVersion: null, targetVersion: '2.2.3-1', downloadSize: 10, installedSize: null, autoUpdate: true }] },
        { manifestUpdatedAt: '2026-08-02', dismissedAt: now - 86_400_000 },
        now,
      ),
    ).toBe(false)
  })
})
