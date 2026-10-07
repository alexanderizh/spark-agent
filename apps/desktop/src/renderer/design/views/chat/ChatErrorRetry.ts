import type { UIMessage } from '../../services/event-mapper'
import type { ComposerPrefillPayload } from './ChatComposerTypes'

/**
 * 重派发轮已启动且自身终态失败：自动重试已耗尽，手动重试应重新开放
 * （重派发轮的输入与原消息保真一致，从原错误卡重试是安全的）。
 */
function redispatchTurnFailed(messages: readonly UIMessage[], fromIndex: number): boolean {
  return messages.slice(fromIndex + 1).some(
    (message) =>
      message.turnSource === 'auto_router_redispatch' &&
      message.blocks.some(
        (block) =>
          (block.kind === 'error' || block.kind === 'runtime_signal') && block.retryable === true,
      ),
  )
}

function buildUserRetryPayload(
  messages: readonly UIMessage[],
  startIndex: number,
  turnId?: string,
): ComposerPrefillPayload | null {
  for (let index = startIndex; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    if (turnId != null && message.turnId !== turnId) continue
    if (message.userMessageVisibility === 'hidden') return null
    if (message.turnSource === 'remote_user') return null
    const text = message.blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.content)
      .join('\n')
      .trim()
    const attachments = message.attachments ?? []
    const sessionReferences = (message.sessionReferences ?? []).map((reference) => ({
      sourceSessionId: reference.sourceSessionId,
      title: reference.title ?? reference.sourceSessionId,
      ...(reference.snapshotSeq !== undefined ? { snapshotSeq: reference.snapshotSeq } : {}),
    }))
    return text.length > 0 || attachments.length > 0 || sessionReferences.length > 0
      ? {
          text,
          attachments,
          ...(sessionReferences.length > 0 ? { sessionReferences } : {}),
        }
      : null
  }
  return null
}

export function buildErrorRetryPayload(
  messages: readonly UIMessage[],
  assistantIndex: number,
): ComposerPrefillPayload | null {
  const assistant = messages[assistantIndex]
  if (
    assistant?.role !== 'assistant' ||
    !assistant.blocks.some(
      (block) =>
        (block.kind === 'error' || block.kind === 'runtime_signal') && block.retryable === true,
    )
  ) {
    return null
  }
  if (assistant.userMessageVisibility === 'hidden') {
    // 重派发轮自身的错误卡：本轮隐藏用户消息已被投影过滤，但原用户消息（seed
    // 来源，紧邻在本轮之前）可安全还原重试载荷。
    if (assistant.turnSource !== 'auto_router_redispatch') return null
    return buildUserRetryPayload(messages, assistantIndex - 1, undefined)
  }
  // 自动重试已穷尽（重派发轮自身终态失败）：交回用户，手动重试重新开放。
  const redispatchFailed = redispatchTurnFailed(messages, assistantIndex)
  // runtime 已决定自动改派重试（executor_failover info 信号在重派发启动前持久化）：
  // 手动重试会与自动重跑双执行（重复计费），不生成重试载荷。仅 info 级（已确认
  // 启动切换）跳过；warning 级只是冻结/取消提示，无自动重跑，重试保留。
  if (
    !redispatchFailed &&
    assistant.blocks.some(
      (block) =>
        block.kind === 'runtime_signal' &&
        block.signal === 'executor_failover' &&
        block.level === 'info',
    )
  ) {
    return null
  }
  // 兜底锚点：重派发轮已启动且未失败（隐藏用户消息被投影过滤，但该轮
  // assistant 消息会携带 auto_router_redispatch 来源标记）。
  if (
    !redispatchFailed &&
    messages
      .slice(assistantIndex + 1)
      .some((message) => message.turnSource === 'auto_router_redispatch')
  ) {
    return null
  }

  return buildUserRetryPayload(messages, assistantIndex - 1, assistant.turnId)
}

/** Queue pause already proves the turn failed, so retry can recover the matching user payload. */
export function buildTurnRetryPayload(
  messages: readonly UIMessage[],
  failedTurnId: string | undefined,
): ComposerPrefillPayload | null {
  if (failedTurnId == null || failedTurnId.length === 0) return null
  // 重派发轮失败的队列恢复：其隐藏用户消息已被投影过滤，从该轮位置向前取
  // 最近的原用户消息（重派发紧跟原轮启动，两者之间无其他用户消息）。
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message == null) continue
    if (message.turnId !== failedTurnId) continue
    if (message.turnSource === 'auto_router_redispatch') {
      return buildUserRetryPayload(messages, index, undefined)
    }
    break
  }
  return buildUserRetryPayload(messages, messages.length - 1, failedTurnId)
}
