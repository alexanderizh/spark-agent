import type { UIMessage } from '../../services/event-mapper'

/**
 * 编辑会截断并替换一整轮，所以只向最新、已落库、普通用户发起且当前未运行的消息开放。
 * 后端会再次做同样的权威校验，避免 renderer 的瞬时状态造成越界回退。
 */
export function getLastEditableUserMessageId(
  messages: readonly UIMessage[],
  busy: boolean,
): string | null {
  if (busy) return null
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  if (
    latestUser == null ||
    latestUser.turnId == null ||
    latestUser.eventIds.length === 0 ||
    latestUser.deliveryState != null ||
    latestUser.userMessageVisibility === 'hidden' ||
    (latestUser.turnSource != null && latestUser.turnSource !== 'user')
  ) {
    return null
  }
  const turnMessages = messages.filter((message) => message.turnId === latestUser.turnId)
  if (turnMessages.some((message) => message.status === 'streaming')) return null
  return latestUser.id
}
