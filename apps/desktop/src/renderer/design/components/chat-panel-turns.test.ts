import { describe, expect, it } from 'vitest'
import type { UIMessage } from '../services/event-mapper'
import {
  getChatPanelUserText,
  groupChatPanelMessagesByTurn,
  sanitizeCanvasUserMessage,
} from './chat-panel-turns'

function message(id: string, role: UIMessage['role'], turnId?: string): UIMessage {
  return {
    id,
    ...(turnId ? { turnId } : {}),
    role,
    status: 'completed',
    blocks: [{ kind: 'text', content: id, isStreaming: false }],
    usage: null,
    eventIds: [id],
  }
}

describe('chat panel turns', () => {
  it('groups user and assistant messages from the same turn', () => {
    const turns = groupChatPanelMessagesByTurn([
      message('user-1', 'user', 'turn-1'),
      message('assistant-1', 'assistant', 'turn-1'),
      message('user-2', 'user', 'turn-2'),
    ])
    expect(turns.map((turn) => turn.messages.length)).toEqual([2, 1])
  })

  it('removes canvas binding and selected-node context from retry text', () => {
    const selectedContext = '[当前选中节点]\n- 节点 node-a\n\n---\n\n继续生成镜头'
    expect(sanitizeCanvasUserMessage(selectedContext)).toBe('继续生成镜头')
    const user = message('user', 'user', 'turn-1')
    user.blocks = [{ kind: 'text', content: selectedContext, isStreaming: false }]
    expect(getChatPanelUserText(user)).toBe('继续生成镜头')
  })
})
