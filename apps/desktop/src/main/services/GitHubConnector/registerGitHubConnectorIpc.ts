import { typedIpcHandle } from '../../ipc/typed-ipc.js'
import { SparkError, createLogger } from '@spark/shared'
import { GitHubConnectorService } from '@spark/agent-runtime'
import { ConnectorConnectionRepository } from '@spark/storage'
import { getDatabase } from '../../db.js'
import { getPluginManager } from '../../ipc/registerPluginIpc.js'

const log = createLogger('github-connector.ipc')

function getGitHubConnectorService(): GitHubConnectorService {
  return new GitHubConnectorService(new ConnectorConnectionRepository(getDatabase()), () =>
    getPluginManager().isRuntimeEnabled('github'),
  )
}

async function ensureGitHubPluginRuntime(): Promise<void> {
  await getPluginManager().initialize()
  if (!getPluginManager().isRuntimeEnabled('github')) {
    throw new SparkError('PERMISSION_DENIED', 'GitHub 连接器未启用，请先在扩展中心启用它')
  }
}

export function registerGitHubConnectorIpc(): void {
  const getConnection = async () => {
    return {
      connection: getGitHubConnectorService().getConnection(),
    }
  }

  const verifyConnection = async (
    req: Parameters<GitHubConnectorService['verifyConnection']>[0],
  ) => {
    await ensureGitHubPluginRuntime()
    const result = await getGitHubConnectorService().verifyConnection(req)
    return {
      accountLogin: result.account.login,
      ...(result.account.avatarUrl != null ? { accountAvatarUrl: result.account.avatarUrl } : {}),
    }
  }

  const connect = async (req: Parameters<GitHubConnectorService['connect']>[0]) => {
    await ensureGitHubPluginRuntime()
    const connection = await getGitHubConnectorService().connect(req)
    log.info(`GitHub connector connected for ${connection.account?.login ?? 'unknown-user'}`)
    return { connection }
  }

  const update = async (req: Parameters<GitHubConnectorService['updateConnection']>[0]) => {
    await ensureGitHubPluginRuntime()
    const connection = await getGitHubConnectorService().updateConnection(req)
    return { connection }
  }

  const disconnect = async () => {
    await getGitHubConnectorService().disconnect()
    return { disconnected: true }
  }

  typedIpcHandle('github-connector:get', getConnection)
  typedIpcHandle('github-connector:verify', verifyConnection)
  typedIpcHandle('github-connector:connect', connect)
  typedIpcHandle('github-connector:update', update)
  typedIpcHandle('github-connector:disconnect', disconnect)
  typedIpcHandle('plugin-runtime:github:get', getConnection)
  typedIpcHandle('plugin-runtime:github:verify', verifyConnection)
  typedIpcHandle('plugin-runtime:github:connect', connect)
  typedIpcHandle('plugin-runtime:github:update', update)
  typedIpcHandle('plugin-runtime:github:disconnect', disconnect)
}
