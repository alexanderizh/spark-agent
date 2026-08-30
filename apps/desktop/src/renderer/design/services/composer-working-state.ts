export function isComposerSessionWorking(status: string | null | undefined): boolean {
  return status === 'running'
}

export function resolveComposerRunningAgentIds({
  teamEnabled,
  runningAgentIds,
  isWorking,
  fallbackAgentId,
}: {
  teamEnabled: boolean
  runningAgentIds: string[]
  isWorking: boolean
  fallbackAgentId?: string | null
}): string[] {
  if (!teamEnabled) return []
  const uniqueIds = Array.from(new Set(runningAgentIds))
  if (uniqueIds.length === 0 && isWorking && fallbackAgentId != null) {
    uniqueIds.push(fallbackAgentId)
  }
  return uniqueIds
}
