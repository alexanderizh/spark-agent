import type { RemoteConnectionConfig } from '@spark/protocol'

export function formatRemoteConnectionCapabilityStatus(
  connection: Pick<RemoteConnectionConfig, 'id' | 'capabilities'>,
): string[] {
  return [
    `连接 ID：${connection.id}`,
    `传输文件：${connection.capabilities.transferFiles ? '已启用' : '未启用'}`,
  ]
}
