import { describe, expect, it } from 'vitest'
import { resolveProviderFileTaskProfile } from './canvasProviderFileNode'
import type { CanvasNode } from './canvas.types'

function providerFileNode(providerProfileId: string, fileId = '398574688191234048'): CanvasNode {
  return {
    data: { providerProfileId, fileId },
  } as CanvasNode
}

describe('resolveProviderFileTaskProfile', () => {
  it('inherits the source profile when no profile is selected', () => {
    expect(
      resolveProviderFileTaskProfile({
        nodes: [providerFileNode('minimax-profile-a')],
      }),
    ).toBe('minimax-profile-a')
  })

  it('keeps an explicitly selected matching profile', () => {
    expect(
      resolveProviderFileTaskProfile({
        nodes: [providerFileNode('minimax-profile-a')],
        selectedProviderProfileId: 'minimax-profile-a',
      }),
    ).toBe('minimax-profile-a')
  })

  it('rejects a profile that differs from the provider file source', () => {
    expect(() =>
      resolveProviderFileTaskProfile({
        nodes: [providerFileNode('minimax-profile-a')],
        selectedProviderProfileId: 'minimax-profile-b',
      }),
    ).toThrow(/MiniMax/)
  })

  it('rejects provider files from multiple profiles in one task', () => {
    expect(() =>
      resolveProviderFileTaskProfile({
        nodes: [
          providerFileNode('minimax-profile-a', 'file-a'),
          providerFileNode('minimax-profile-b', 'file-b'),
        ],
      }),
    ).toThrow(/多个渠道配置/)
  })
})
