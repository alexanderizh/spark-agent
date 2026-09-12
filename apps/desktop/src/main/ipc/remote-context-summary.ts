export type RemoteContextSummary = {
  workspaceName?: string
  workspaceId?: string
  sessionTitle?: string
  sessionId?: string
  providerName?: string
  providerKind?: string
  providerId?: string
  modelId?: string
}

function formatNamedValue(name: string | undefined, id: string | undefined, empty: string): string {
  if (name != null && id != null && name !== id) return `${name}（${id}）`
  return name ?? id ?? empty
}

export function formatRemoteContextSummary(context: RemoteContextSummary): string {
  const provider = formatNamedValue(
    context.providerName,
    context.providerKind ?? context.providerId,
    '未设置',
  )
  return [
    '当前上下文',
    `工作区：${formatNamedValue(context.workspaceName, context.workspaceId, '不使用项目')}`,
    `会话：${formatNamedValue(context.sessionTitle, context.sessionId, '未设置')}`,
    `渠道：${provider}`,
    `模型：${context.modelId ?? '未设置'}`,
  ].join('\n')
}

export function appendRemoteContextSummary(message: string, context: RemoteContextSummary): string {
  return `${message}\n\n${formatRemoteContextSummary(context)}`
}
