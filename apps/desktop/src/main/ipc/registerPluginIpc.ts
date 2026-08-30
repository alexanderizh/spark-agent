import { app } from 'electron'
import { join } from 'node:path'
import type {
  PluginMarketplaceInstallRequest,
  PluginMarketplaceSearchRequest,
  PluginSetPermissionRequest,
} from '@spark/protocol'
import { PluginManager } from '@spark/agent-runtime'
import { getDatabase } from '../db.js'
import { typedIpcHandle, pushStreamEvent } from './typed-ipc.js'

let manager: PluginManager | null = null

export function getPluginManager(): PluginManager {
  if (manager == null) {
    manager = new PluginManager({
      db: getDatabase(),
      pluginRoot: join(app.getPath('userData'), 'plugins'),
      tempRoot: join(app.getPath('temp'), 'spark-plugin-installs'),
    })
  }
  return manager
}

export function resetPluginManagerForTests(): void {
  manager = null
}

export function registerPluginIpc(): void {
  typedIpcHandle('plugin:list', async (request) => {
    await getPluginManager().initialize()
    return { plugins: getPluginManager().list(request.includeDisabled !== false) }
  })

  typedIpcHandle('plugin:inspect-local', async (request) => ({
    inspection: await getPluginManager().inspectLocal(request.sourcePath),
  }))

  typedIpcHandle('plugin:install-local', async (request) => {
    const plugin = await getPluginManager().installLocal(
      request.sourcePath,
      request.approvedPermissions,
      request.enable !== false,
    )
    pushStreamEvent('stream:config:changed', { scope: 'plugin', action: 'install', id: plugin.id })
    return { plugin }
  })

  typedIpcHandle('plugin:uninstall', async (request) => {
    const success = await getPluginManager().uninstall(request.id)
    pushStreamEvent('stream:config:changed', {
      scope: 'plugin',
      action: 'uninstall',
      id: request.id,
    })
    return { success }
  })

  typedIpcHandle('plugin:set-enabled', async (request) => {
    const plugin = await getPluginManager().setEnabled(request.id, request.enabled)
    pushStreamEvent('stream:config:changed', { scope: 'plugin', action: 'toggle', id: plugin.id })
    return { plugin }
  })

  typedIpcHandle('plugin:set-permission', async (request: PluginSetPermissionRequest) => {
    const plugin = await getPluginManager().setPermission(
      request.id,
      request.permission,
      request.state,
    )
    pushStreamEvent('stream:config:changed', {
      scope: 'plugin',
      action: 'permission',
      id: plugin.id,
    })
    return { plugin }
  })

  typedIpcHandle('plugin-marketplace:list', async () => ({
    marketplaces: getPluginManager().listMarketplaces(),
  }))

  typedIpcHandle('plugin-marketplace:update', async (request) => ({
    marketplace: getPluginManager().updateMarketplace(request.id, request),
  }))

  typedIpcHandle('plugin-marketplace:search', async (request: PluginMarketplaceSearchRequest) =>
    getPluginManager().searchMarketplace(request),
  )

  typedIpcHandle('plugin-marketplace:install', async (request: PluginMarketplaceInstallRequest) => {
    const search = await getPluginManager().searchMarketplace({
      query: request.pluginId,
      marketplaceId: request.marketplaceId,
      limit: 100,
    })
    const item = search.plugins.find((candidate) => candidate.id === request.pluginId)
    if (item == null) throw new Error(`Plugin not found in marketplace: ${request.pluginId}`)
    const plugin = await getPluginManager().installMarketplace(
      item,
      request.approvedPermissions,
      request.enable !== false,
    )
    pushStreamEvent('stream:config:changed', { scope: 'plugin', action: 'install', id: plugin.id })
    return { plugin }
  })
}
