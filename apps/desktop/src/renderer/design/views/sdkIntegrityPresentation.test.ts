import type { SdkIntegrityItem } from '@spark/protocol'
import { describe, expect, it } from 'vitest'
import { needsSdkInstallAction } from './sdkIntegrityPresentation'

function sdk(overrides: Partial<SdkIntegrityItem> = {}): SdkIntegrityItem {
  return {
    packageName: '@anthropic-ai/claude-agent-sdk',
    displayName: 'Claude Agent SDK',
    installed: true,
    installedVersion: '0.3.211',
    latestVersion: '0.3.211',
    updateAvailable: false,
    latestChecked: true,
    ...overrides,
  }
}

describe('needsSdkInstallAction', () => {
  it('does not treat an SDK without a separate runtime as missing a runtime', () => {
    expect(needsSdkInstallAction(sdk())).toBe(false)
  })

  it('keeps package and managed-runtime installs actionable', () => {
    expect(needsSdkInstallAction(sdk({ installed: false }))).toBe(true)
    expect(needsSdkInstallAction(sdk({ updateAvailable: true }))).toBe(true)
    expect(
      needsSdkInstallAction(
        sdk({
          runtime: {
            installed: false,
            installedVersion: null,
            latestVersion: null,
            updateAvailable: false,
            latestChecked: false,
            targetTriple: null,
            artifactId: null,
          },
        }),
      ),
    ).toBe(true)
  })
})
