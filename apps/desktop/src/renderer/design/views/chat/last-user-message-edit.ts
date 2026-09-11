import type { UIMessage } from '../../services/event-mapper'

/**
 * 编辑会截断并替换一整轮，所以只向最新、普通用户发起且当前未运行的消息开放。
 * 正常轮次要求用户事件已落库；发送后立即中止的极短窗口允许带 turnId 的 cancelled
 * 乐观消息进入编辑，后端再用持久化请求与取消终态做权威校验。
 */
export function getLastEditableUserMessageId(
  messages: readonly UIMessage[],
  busy: boolean,
): string | null {
  if (busy) return null
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  const isPersistedMessage =
    latestUser != null && latestUser.eventIds.length > 0 && latestUser.deliveryState == null
  const isImmediatelyCancelledMessage =
    latestUser?.deliveryState === 'cancelled' &&
    latestUser.clientId != null &&
    latestUser.eventIds.length === 0
  if (
    latestUser == null ||
    latestUser.turnId == null ||
    (!isPersistedMessage && !isImmediatelyCancelledMessage) ||
    latestUser.userMessageVisibility === 'hidden' ||
    (latestUser.turnSource != null && latestUser.turnSource !== 'user')
  ) {
    return null
  }
  const turnMessages = messages.filter((message) => message.turnId === latestUser.turnId)
  if (turnMessages.some((message) => message.status === 'streaming')) return null
  return latestUser.id
}
