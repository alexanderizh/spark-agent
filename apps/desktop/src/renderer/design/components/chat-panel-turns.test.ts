import { describe, expect, it } from 'vitest'
import type { UIMessage } from '../services/event-mapper'
import {
  getChatPanelUserNodeReferences,
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

  it('removes combined canvas binding and selected-node context from display text', () => {
    const combinedContext = [
      '[画布绑定]',
      'canvasProjectId: project-a',
      'activeBoardId: board-a',
      '',
      '当前会话已启用 builtin:canvas-studio。',
      '',
      '---',
      '[当前选中节点]',
      '- 节点 node-a',
      '',
      '[节点能力使用要求] 请先查询可用动作。',
      '---',
      '',
      '继续生成镜头',
      '',
      '---',
      '',
      '保留用户正文里的分隔线',
    ].join('\n')

    expect(sanitizeCanvasUserMessage(combinedContext)).toBe(
      '继续生成镜头\n\n---\n\n保留用户正文里的分隔线',
    )
  })

  it('restores sent canvas node references from the persisted user context', () => {
    const user = message('user', 'user', 'turn-1')
    user.blocks = [
      {
        kind: 'text',
        content: [
          '[当前选中节点]',
          '- 节点 image-1 | 类型 image | 子类型 image | 标题「image.png」 | 图片地址 safe-file://image.png',
          '- 节点 text-1 | 类型 text | 子类型 screenplay | 标题「第一集剧本」 | 内容预览: 场1 夜 内景',
          '- 节点 image-1 | 类型 image | 子类型 image | 标题「重复引用」',
          '',
          '[节点能力使用要求] 请先查询可用动作。',
          '',
          '---',
          '',
          '根据引用继续生成',
        ].join('\n'),
        isStreaming: false,
      },
    ]

    expect(getChatPanelUserNodeReferences(user)).toEqual([
      { id: 'image-1', type: 'image', title: 'image.png' },
      { id: 'text-1', type: 'text', title: '第一集剧本' },
    ])
  })

  it('does not infer node references from ordinary user text', () => {
    const user = message('user', 'user', 'turn-1')
    user.blocks = [{ kind: 'text', content: '请处理节点 image-1', isStreaming: false }]

    expect(getChatPanelUserNodeReferences(user)).toEqual([])
  })
})
