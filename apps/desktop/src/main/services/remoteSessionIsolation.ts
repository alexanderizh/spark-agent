import type { RemoteConnectionConfig } from '@spark/protocol'

export function remoteConnectionsForSession(
  connections: readonly RemoteConnectionConfig[],
  sessionId: string | undefined,
  exceptConnectionId?: string,
): RemoteConnectionConfig[] {
  if (sessionId == null) return []
  return connections.filter(
    (connection) =>
      connection.id !== exceptConnectionId && connection.defaultSessionId === sessionId,
  )
}

export function canShareRemoteSession(
  connection: Pick<RemoteConnectionConfig, 'allowSharedSession'>,
  others: readonly Pick<RemoteConnectionConfig, 'allowSharedSession'>[],
): boolean {
  return (
    connection.allowSharedSession === true &&
    others.every((item) => item.allowSharedSession === true)
  )
}

export function canUseConfiguredRemoteSession(
  connections: readonly RemoteConnectionConfig[],
  connection: RemoteConnectionConfig,
): boolean {
  if (connection.defaultSessionId == null) return false
  const others = remoteConnectionsForSession(
    connections,
    connection.defaultSessionId,
    connection.id,
  )
  return others.length === 0 || canShareRemoteSession(connection, others)
}

export function remoteRouteKey(connectionId: string, externalId: string): string {
  return `${connectionId}\u0000${externalId}`
}
