import { typedIpcHandle } from '../../ipc/typed-ipc.js'
import { SparkError, createLogger } from '@spark/shared'
import { GitHubConnectorService } from '@spark/agent-runtime'
import { ConnectorConnectionRepository } from '@spark/storage'
import { getDatabase } from '../../db.js'

const log = createLogger('github-connector.ipc')

function getGitHubConnectorService(): GitHubConnectorService {
  return new GitHubConnectorService(new ConnectorConnectionRepository(getDatabase()))
}

export function registerGitHubConnectorIpc(): void {
  typedIpcHandle('github-connector:get', async () => {
    return {
      connection: getGitHubConnectorService().getConnection(),
    }
  })

  typedIpcHandle('github-connector:verify', async (req) => {
    const result = await getGitHubConnectorService().verifyConnection(req)
    return {
      accountLogin: result.account.login,
      ...(result.account.avatarUrl != null ? { accountAvatarUrl: result.account.avatarUrl } : {}),
    }
  })

  typedIpcHandle('github-connector:connect', async (req) => {
    const connection = await getGitHubConnectorService().connect(req)
    log.info(`GitHub connector connected for ${connection.account?.login ?? 'unknown-user'}`)
    return { connection }
  })

  typedIpcHandle('github-connector:update', async (req) => {
    if (req.authMethod != null && req.authMethod !== 'pat') {
      throw new SparkError('VALIDATION_FAILED', `Unsupported GitHub auth method: ${req.authMethod}`)
    }
    const connection = await getGitHubConnectorService().updateConnection(req)
    return { connection }
  })

  typedIpcHandle('github-connector:disconnect', async () => {
    await getGitHubConnectorService().disconnect()
    return { disconnected: true }
  })
}
