export function shouldShowAssistantIdentity(
  teamEnabled: boolean,
  messageAgentId: string,
  primaryAgentId: string,
): boolean {
  return teamEnabled || messageAgentId !== primaryAgentId
}
