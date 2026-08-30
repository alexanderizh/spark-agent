import { describe, expect, it } from 'vitest'
import type { InstalledPluginItem, PluginMarketplaceItem } from '@spark/protocol'
import { filterMarketplaceItemsForDisplay, groupInstalledPlugins } from './plugin-marketplace-model'

function installed(overrides: Partial<InstalledPluginItem>): InstalledPluginItem {
  return {
    id: 'spark.example',
    version: '1.0.0',
    displayName: 'Example',
    description: 'Example plugin',
    author: 'Spark',
    installPath: 'builtin://spark.example',
    source: 'bundled',
    enabled: true,
    state: 'installed',
    trust: 'bundled',
    integritySha256: 'a'.repeat(64),
    permissions: [],
    contributionCounts: { skills: 0, mcpServers: 0, connectors: 0, runtimes: 1 },
    installedAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    ...overrides,
  }
}

function market(overrides: Partial<PluginMarketplaceItem>): PluginMarketplaceItem {
  return {
    marketplaceId: 'official',
    id: 'acme.example',
    version: '1.0.0',
    displayName: 'Example',
    description: 'Example plugin',
    author: 'Acme',
    categories: [],
    tags: [],
    manifestUrl: 'https://example.test/manifest.json',
    packageUrl: 'https://example.test/package.tar',
    packageSha256: 'b'.repeat(64),
    requiredPermissions: [],
    trust: 'verified',
    installed: false,
    ...overrides,
  }
}

describe('plugin marketplace display model', () => {
  it('collapses same-name bundled and imported rows while retaining uninstallable IDs', () => {
    const groups = groupInstalledPlugins([
      installed({
        id: 'notion.workspace',
        displayName: 'Notion',
        source: 'local',
        trust: 'unverified',
        contributionCounts: { skills: 1, mcpServers: 0, connectors: 1 },
      }),
      installed({ id: 'spark.notion', displayName: 'Notion', runtimeId: 'notion' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      plugin: {
        id: 'spark.notion',
        contributionCounts: { skills: 1, connectors: 1, runtimes: 1 },
      },
      memberIds: ['spark.notion', 'notion.workspace'],
      uninstallIds: ['notion.workspace'],
    })
  })

  it('hides installed names and keeps one verified marketplace result per plugin ID', () => {
    const installedGroups = groupInstalledPlugins([installed({ displayName: 'Notion' })])
    const visible = filterMarketplaceItemsForDisplay(
      [
        market({ id: 'spark.example', displayName: 'Example' }),
        market({
          id: 'acme.mail',
          displayName: 'Mail',
          marketplaceId: 'mirror',
          trust: 'unverified',
        }),
        market({
          id: 'acme.mail',
          displayName: 'Mail',
          marketplaceId: 'official',
          trust: 'verified',
        }),
        market({ id: 'acme.notion', displayName: 'Notion' }),
      ],
      installedGroups,
    )

    expect(visible.map((item) => item.id)).toEqual(['acme.mail'])
    expect(visible[0]?.marketplaceId).toBe('official')
  })
})
