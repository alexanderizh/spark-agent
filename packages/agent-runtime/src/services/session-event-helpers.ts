/**
 * Session 事件辅助纯函数（从 session.service.ts 拆分，D-13）。
 *
 * 包含：
 * - createUserCancelledTurnEvent：构造"用户取消"终态事件
 * - createInterruptedTurnEvents：app 重启时合成中断 + 取消事件
 * - shouldRunTurnPostProcessing：判断是否需要跑 turn 后处理
 * - collectCompleteAssistantTurnText：从 assistant_message 事件序列中聚合完整正文
 *
 * session.service.ts 顶部 re-export 本文件，保持向后兼容。
 */

import crypto from 'node:crypto'
import type { AgentEvent, AgentStatusEvent, AssistantMessageEvent } from '@spark/protocol'
import { StreamTerminalizer } from '../sdk/stream-terminalizer.js'

export function createUserCancelledTurnEvent(
  sessionId: string,
  turnId: string,
  timestamp: string = new Date().toISOString(),
): AgentStatusEvent {
  return {
    id: crypto.randomUUID(),
    type: 'agent_status',
    sessionId,
    turnId,
    timestamp,
    seq: 0,
    status: 'cancelled',
    message: 'Stopped by user',
  }
}

export function createInterruptedTurnEvents(
  sessionId: string,
  turnId: string,
  seq: number,
  timestamp: string = new Date().toISOString(),
  persistedEvents: AgentEvent[] = [],
): AgentEvent[] {
  let nextSeq = seq
  const terminalizer = new StreamTerminalizer()
  for (const event of persistedEvents) terminalizer.observe(event)
  const completed = terminalizer.finalize(() => ({
    id: crypto.randomUUID(),
    sessionId,
    turnId,
    timestamp,
    seq: nextSeq++,
  }))
  return [
    ...completed,
    {
      id: crypto.randomUUID(),
      type: 'agent_error',
      sessionId,
      turnId,
      timestamp,
      seq: nextSeq++,
      code: 'APP_RESTARTED',
      message: 'The previous turn was stopped because Spark Agent restarted.',
      retryable: true,
    },
    {
      id: crypto.randomUUID(),
      type: 'agent_status',
      sessionId,
      turnId,
      timestamp,
      seq: nextSeq,
      status: 'cancelled',
      message: 'Stopped after app restart',
    },
  ]
}

export function shouldRunTurnPostProcessing(status: AgentStatusEvent['status'] | null): boolean {
  return status === 'completed'
}

export function collectCompleteAssistantTurnText(events: AssistantMessageEvent[]): string {
  const textBySegment = new Map<string, string>()
  const segmentOrder: string[] = []
  const anonymousParts: string[] = []
  let finalText = ''

  for (const event of events) {
    if (event.mode !== 'complete' || typeof event.content !== 'string') continue
    if (event.isFinal) {
      finalText = event.content
      continue
    }
    if (typeof event.segmentId === 'string' && event.segmentId.length > 0) {
      if (!textBySegment.has(event.segmentId)) segmentOrder.push(event.segmentId)
      textBySegment.set(event.segmentId, event.content)
      continue
    }
    anonymousParts.push(event.content)
  }

  if (finalText.length > 0) return finalText

  return [...segmentOrder.map((segmentId) => textBySegment.get(segmentId) ?? ''), ...anonymousParts]
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n')
}
