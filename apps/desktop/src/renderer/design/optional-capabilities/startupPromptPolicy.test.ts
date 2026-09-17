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
        {
          ...snapshot,
          remoteAvailable: true,
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
        },
        { manifestUpdatedAt: '2026-08-02', dismissedAt: now - 86_400_000 },
        now,
      ),
    ).toBe(false)
  })
  it('prompts for pending core component updates', () => {
    const snapshot = {
      capabilities: [createUpdateCapability('0.153.4')],
      checkedAt: new Date(now).toISOString(),
      manifestUpdatedAt: '2026-08-02',
      remoteAvailable: true,
    }
    // 没有提醒记录时应当提示。
    expect(shouldShowCapabilityPrompt(snapshot, null, now)).toBe(true)
  })

  it('stops reminding for an update until the target version changes', () => {
    const snapshot = {
      capabilities: [createUpdateCapability('0.153.4')],
      checkedAt: new Date(now).toISOString(),
      manifestUpdatedAt: '2026-08-02',
      remoteAvailable: true,
    }
    const dismissed = {
      manifestUpdatedAt: '2026-08-02',
      dismissedAt: now,
      dismissedTargets: { 'codex-runtime': '0.153.4' },
    }
    // 同一目标版本不再提醒（即使 manifest 变了、冷却也早过了）。
    expect(shouldShowCapabilityPrompt(snapshot, dismissed, now + 30 * 86_400_000)).toBe(false)
    // 出现更新的目标版本后重新提醒。
    expect(
      shouldShowCapabilityPrompt(
        {
          ...snapshot,
          manifestUpdatedAt: '2026-09-01',
          capabilities: [createUpdateCapability('0.160.0')],
        },
        dismissed,
        now + 30 * 86_400_000,
      ),
    ).toBe(true)
  })

  it('scopes the startup opt-out to the announced version instead of muting forever', () => {
    const snapshot = {
      capabilities: [createUpdateCapability('0.153.4')],
      checkedAt: new Date(now).toISOString(),
      manifestUpdatedAt: '2026-08-02',
      remoteAvailable: true,
    }
    // 已经告知过该目标版本：不再打扰。
    expect(
      shouldShowCapabilityPrompt(
        snapshot,
        {
          manifestUpdatedAt: '2026-08-02',
          dismissedAt: now,
          disabled: true,
          dismissedTargets: { 'codex-runtime': '0.153.4' },
        },
        now,
      ),
    ).toBe(false)
    // 勾选「不再提醒」后核心组件出了新版本：必须再提醒一次。
    expect(
      shouldShowCapabilityPrompt(
        {
          ...snapshot,
          manifestUpdatedAt: '2026-09-01',
          capabilities: [createUpdateCapability('0.160.0')],
        },
        {
          manifestUpdatedAt: '2026-08-02',
          dismissedAt: now,
          disabled: true,
          dismissedTargets: { 'codex-runtime': '0.153.4' },
        },
        now,
      ),
    ).toBe(true)
  })

  it('ignores components that cannot actually be installed', () => {
    expect(
      shouldShowCapabilityPrompt(
        {
          capabilities: [
            {
              id: 'codex-runtime' as const,
              displayName: 'Codex 运行时',
              description: 'Codex',
              state: 'update_available' as const,
              installedVersion: '0.149.0',
              targetVersion: '0.153.4',
              downloadSize: 0,
              installedSize: 200,
              autoUpdate: false,
            },
          ],
          checkedAt: new Date(now).toISOString(),
          manifestUpdatedAt: '2026-08-02',
          remoteAvailable: true,
        },
        null,
        now,
      ),
    ).toBe(false)
  })
})

function createUpdateCapability(targetVersion: string) {
  return {
    id: 'codex-runtime' as const,
    displayName: 'Codex 运行时',
    description: 'Codex',
    state: 'update_available' as const,
    installedVersion: '0.149.0',
    targetVersion,
    downloadSize: 200,
    installedSize: 200,
    autoUpdate: false,
  }
}
