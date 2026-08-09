import type { InstalledPluginItem, PluginMarketplaceItem } from '@spark/protocol'

export interface InstalledPluginGroup {
  plugin: InstalledPluginItem
  memberIds: string[]
  uninstallIds: string[]
}

const SOURCE_PRIORITY: Record<InstalledPluginItem['source'], number> = {
  bundled: 0,
  marketplace: 1,
  local: 2,
}

const TRUST_PRIORITY: Record<InstalledPluginItem['trust'], number> = {
  bundled: 0,
  verified: 1,
  unverified: 2,
  blocked: 3,
}

function displayKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function compareInstalledPlugins(left: InstalledPluginItem, right: InstalledPluginItem): number {
  const sourceDifference = SOURCE_PRIORITY[left.source] - SOURCE_PRIORITY[right.source]
  if (sourceDifference !== 0) return sourceDifference
  const trustDifference = TRUST_PRIORITY[left.trust] - TRUST_PRIORITY[right.trust]
  if (trustDifference !== 0) return trustDifference
  if (Boolean(left.runtimeId) !== Boolean(right.runtimeId)) return left.runtimeId ? -1 : 1
  return left.id.localeCompare(right.id)
}

function mergePermissionGrants(items: InstalledPluginItem[]): InstalledPluginItem['permissions'] {
  const grants = new Map<
    InstalledPluginItem['permissions'][number]['permission'],
    InstalledPluginItem['permissions'][number]
  >()
  const statePriority = { granted: 0, pending: 1, denied: 2 } as const
  for (const item of items) {
    for (const grant of item.permissions) {
      const current = grants.get(grant.permission)
      if (current == null || statePriority[grant.state] < statePriority[current.state]) {
        grants.set(grant.permission, grant)
      }
    }
  }
  return Array.from(grants.values())
}

function mergeContributionCounts(
  items: InstalledPluginItem[],
): InstalledPluginItem['contributionCounts'] {
  const counts = items.reduce(
    (result, item) => ({
      skills: result.skills + item.contributionCounts.skills,
      mcpServers: result.mcpServers + item.contributionCounts.mcpServers,
      connectors: result.connectors + item.contributionCounts.connectors,
      runtimes: result.runtimes + (item.contributionCounts.runtimes ?? 0),
    }),
    { skills: 0, mcpServers: 0, connectors: 0, runtimes: 0 },
  )
  if (counts.runtimes > 0) return counts
  return {
    skills: counts.skills,
    mcpServers: counts.mcpServers,
    connectors: counts.connectors,
  }
}

function mergeInstalledPlugins(
  primary: InstalledPluginItem,
  members: InstalledPluginItem[],
): InstalledPluginItem {
  return {
    ...primary,
    enabled: members.every((item) => item.enabled),
    permissions: mergePermissionGrants(members),
    contributionCounts: mergeContributionCounts(members),
    updatedAt: members.reduce(
      (latest, item) => (item.updatedAt > latest ? item.updatedAt : latest),
      primary.updatedAt,
    ),
  }
}

/**
 * Installed rows can come from different sources while describing one user-facing capability.
 * Keep one canonical card and retain the IDs needed for lifecycle operations.
 */
export function groupInstalledPlugins(plugins: InstalledPluginItem[]): InstalledPluginGroup[] {
  const unique = Array.from(new Map(plugins.map((plugin) => [plugin.id, plugin])).values())
  const groups = new Map<string, InstalledPluginItem[]>()
  for (const plugin of unique) {
    const key = displayKey(plugin.displayName) || plugin.id
    groups.set(key, [...(groups.get(key) ?? []), plugin])
  }

  return Array.from(groups.values())
    .map((members) => {
      const orderedMembers = [...members].sort(compareInstalledPlugins)
      const primary = orderedMembers[0]
      if (primary == null) throw new Error('Installed plugin group cannot be empty')
      return {
        plugin: mergeInstalledPlugins(primary, orderedMembers),
        memberIds: orderedMembers.map((item) => item.id),
        uninstallIds: orderedMembers
          .filter((item) => item.source !== 'bundled')
          .map((item) => item.id),
      }
    })
    .sort((left, right) => left.plugin.displayName.localeCompare(right.plugin.displayName))
}

function compareMarketplaceItems(
  left: PluginMarketplaceItem,
  right: PluginMarketplaceItem,
): number {
  if (left.trust !== right.trust) return left.trust === 'verified' ? -1 : 1
  if (left.installed !== right.installed) return left.installed ? 1 : -1
  const leftParts = left.version.split(/[.+-]/, 1)[0]?.split('.').map(Number) ?? []
  const rightParts = right.version.split(/[.+-]/, 1)[0]?.split('.').map(Number) ?? []
  for (let index = 0; index < 3; index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return `${left.marketplaceId}:${left.version}`.localeCompare(
    `${right.marketplaceId}:${right.version}`,
  )
}

/** Hide installed capabilities and collapse duplicate marketplace listings before rendering. */
export function filterMarketplaceItemsForDisplay(
  items: PluginMarketplaceItem[],
  installed: InstalledPluginGroup[],
): PluginMarketplaceItem[] {
  const installedIds = new Set(installed.flatMap((group) => group.memberIds))
  const installedNames = new Set(installed.map((group) => displayKey(group.plugin.displayName)))
  const candidates = items.filter(
    (item) =>
      !installedIds.has(item.id) &&
      !installedNames.has(displayKey(item.displayName)) &&
      !item.installed,
  )
  const byPluginId = new Map<string, PluginMarketplaceItem>()
  for (const item of candidates) {
    const current = byPluginId.get(item.id)
    if (current == null || compareMarketplaceItems(item, current) < 0) {
      byPluginId.set(item.id, item)
    }
  }
  const byDisplayName = new Map<string, PluginMarketplaceItem>()
  for (const item of byPluginId.values()) {
    const key = displayKey(item.displayName) || item.id
    const current = byDisplayName.get(key)
    if (current == null || compareMarketplaceItems(item, current) < 0) {
      byDisplayName.set(key, item)
    }
  }
  return Array.from(byDisplayName.values()).sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  )
}
