type ChatMessageRole = {
  id: string
  role: 'user' | 'assistant'
}

/** Returns the newest assistant message IDs while ignoring intervening user messages. */
export function getRecentAssistantMessageIds(
  messages: readonly ChatMessageRole[],
  limit: number,
): Set<string> {
  const ids = new Set<string>()
  if (limit <= 0) return ids

  for (let index = messages.length - 1; index >= 0 && ids.size < limit; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant') ids.add(message.id)
  }

  return ids
}
