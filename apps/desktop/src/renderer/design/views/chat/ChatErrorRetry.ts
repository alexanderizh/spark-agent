import type { UIMessage } from '../../services/event-mapper'
import type { ComposerPrefillPayload } from './ChatComposerTypes'

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
  if (assistant.userMessageVisibility === 'hidden') return null
  // runtime 已决定自动改派重试（executor_failover info 信号与错误同轮持久化，
  // 早于重派发轮启动）：手动重试会与自动重跑双执行（重复计费），不生成重试载荷。
  // 仅 info 级（已武装切换）跳过；warning 级只是冻结提示，无自动重跑，重试保留。
  if (
    assistant.blocks.some(
      (block) =>
        block.kind === 'runtime_signal' &&
        block.signal === 'executor_failover' &&
        block.level === 'info',
    )
  ) {
    return null
  }
  // 兜底锚点：重派发轮已启动（隐藏用户消息被投影过滤，但该轮 assistant 消息
  // 会携带 auto_router_redispatch 来源标记）。
  if (
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
  return buildUserRetryPayload(messages, messages.length - 1, failedTurnId)
}
