import { isEngineCompactSummaryText } from '@spark/protocol'
import type { UIBlock, UIMessage } from '../../services/event-mapper'
import type { ComposerPrefillPayload } from './ChatComposerTypes'

/**
 * 失败轮智能重试的继续指令：失败轮已有实质产出时发送，让模型基于会话历史中的
 * 半截产出从中断处继续，而不是整轮重跑丢弃已完成进度。
 */
export const ERROR_CONTINUE_INSTRUCTION =
  '上一轮回复因错误中断，请基于已完成的部分继续完成任务，不要重复已完成的步骤。'

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

/**
 * 自动改派重跑抑制（手动重试与手动续跑共用）：重派发已启动且尚未终态失败时，
 * 手动动作会与自动重跑双执行（重复计费、重复副作用）。redispatchTurnFailed 为真
 * 说明自动重试已穷尽、交回用户，不再抑制。
 */
function manualActionSuppressedByAutoRedispatch(
  messages: readonly UIMessage[],
  assistantIndex: number,
): boolean {
  if (redispatchTurnFailed(messages, assistantIndex)) return false
  const assistant = messages[assistantIndex]
  // executor_failover info 信号在重派发启动前持久化：仅 info 级（已确认启动切换）
  // 抑制；warning 级只是冻结/取消提示，无自动重跑，手动动作保留。
  if (
    assistant?.blocks.some(
      (block) =>
        block.kind === 'runtime_signal' &&
        block.signal === 'executor_failover' &&
        block.level === 'info',
    )
  ) {
    return true
  }
  // 兜底锚点：重派发轮已启动且未失败（隐藏用户消息被投影过滤，但该轮
  // assistant 消息会携带 auto_router_redispatch 来源标记）。
  return messages
    .slice(assistantIndex + 1)
    .some((message) => message.turnSource === 'auto_router_redispatch')
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
  // 自动改派重跑进行中：手动重试会双执行，不生成载荷（口径见
  // manualActionSuppressedByAutoRedispatch）。
  if (manualActionSuppressedByAutoRedispatch(messages, assistantIndex)) return null

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

/**
 * 实质产出判定：失败 turn 的任一 assistant 消息存在非空文本块（trim 后非空）、
 * 工具调用块或文件变更块，即认为失败轮已有可延续的进度。错误文案走独立 error /
 * runtime_signal 块而不落入文本块（见 event-mapper 映射），文本块内容可直接视为
 * 模型产出；唯一例外是引擎注入的压缩承接摘要——那是上下文承接文案，不是产出。
 */
function blockIsSubstantiveOutput(block: UIBlock): boolean {
  if (block.kind === 'tool_call' || block.kind === 'file_change') return true
  if (block.kind !== 'text') return false
  return block.content.trim().length > 0 && !isEngineCompactSummaryText(block.content)
}

/** 失败 turn 是否已有实质产出（智能重试可从断点继续的前提）。 */
export function turnHasSubstantiveOutput(
  messages: readonly UIMessage[],
  failedTurnId: string | undefined,
): boolean {
  if (failedTurnId == null || failedTurnId.length === 0) return false
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      message.turnId === failedTurnId &&
      message.blocks.some(blockIsSubstantiveOutput),
  )
}

/**
 * 智能重试载荷：失败轮已有实质产出 → 返回继续指令消息（不带失败轮附件与会话引用，
 * 原输入已在会话历史中，重复投递反而污染上下文）；无产出（如鉴权错误在首 token 前
 * 失败）→ 返回 null，调用方回落原消息重发。
 */
export function buildErrorContinuePayload(
  messages: readonly UIMessage[],
  failedTurnId: string | undefined,
): ComposerPrefillPayload | null {
  if (!turnHasSubstantiveOutput(messages, failedTurnId)) return null
  return { text: ERROR_CONTINUE_INSTRUCTION, attachments: [] }
}

/**
 * 消息级错误卡的「继续完成」载荷：与 buildErrorRetryPayload 共用自动改派抑制口径
 * （自动重跑进行中不允许手动续跑，避免双执行），但不要求原用户消息可还原——隐藏
 * 内部轮（如 goal 迭代）已有产出时，继续指令依然可以安全续跑。无实质产出返回 null。
 */
export function buildMessageErrorContinuePayload(
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
  if (manualActionSuppressedByAutoRedispatch(messages, assistantIndex)) return null
  return buildErrorContinuePayload(messages, assistant.turnId)
}
