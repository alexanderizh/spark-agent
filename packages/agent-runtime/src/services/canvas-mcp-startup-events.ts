import { randomUUID } from 'node:crypto'
import type { AgentErrorEvent, AgentStatusEvent, UserMessageEvent } from '@spark/protocol'

export const CANVAS_MCP_UNAVAILABLE_MESSAGE =
  '画布工具未能启动，本轮已停止，未对画布执行任何修改。请重新打开画布后重试；若仍失败，请重启或更新 Spark Agent。'

export function createCanvasMcpUnavailableEvents(input: {
  sessionId: string
  turnId: string
  userMessage: string
  rawError: string
}): [UserMessageEvent, AgentErrorEvent, AgentStatusEvent] {
  const makeBase = () => ({
    id: randomUUID(),
    sessionId: input.sessionId,
    turnId: input.turnId,
    timestamp: new Date().toISOString(),
    seq: 0,
  })

  return [
    {
      ...makeBase(),
      type: 'user_message',
      content: input.userMessage,
    },
    {
      ...makeBase(),
      type: 'agent_error',
      code: 'CANVAS_MCP_UNAVAILABLE',
      message: CANVAS_MCP_UNAVAILABLE_MESSAGE,
      retryable: true,
      rawError: input.rawError,
    },
    {
      ...makeBase(),
      type: 'agent_status',
      status: 'error',
      message: 'Canvas tools are unavailable',
    },
  ]
}
