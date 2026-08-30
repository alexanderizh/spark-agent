export function hasChatConfigScope(
  sessionId: string | undefined,
  workspaceId: string | undefined,
): boolean {
  return sessionId != null || workspaceId != null
}
