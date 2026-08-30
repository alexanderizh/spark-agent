import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { UIBlock } from '../services/event-mapper'
import { ChatPanelThinkingGroup } from './ChatPanelThinkingGroup'
import { getChatPanelThinkingBlocks } from './chat-panel-thinking'

describe('ChatPanelThinkingGroup', () => {
  it('collects every thinking segment from one message in source order', () => {
    const blocks: UIBlock[] = [
      { kind: 'thinking', content: '先读取画布', isStreaming: false, segmentId: 'thinking-1' },
      {
        kind: 'tool_call',
        toolCallId: 'tool-1',
        toolName: 'read_canvas',
        toolInput: {},
        status: 'success',
        output: '',
        error: undefined,
        durationMs: 10,
      },
      { kind: 'thinking', content: '再整理节点', isStreaming: true, segmentId: 'thinking-2' },
    ]

    expect(getChatPanelThinkingBlocks(blocks).map((block) => block.content)).toEqual([
      '先读取画布',
      '再整理节点',
    ])
  })

  it('renders one disclosure for multiple segments and reflects streaming state', () => {
    const html = renderToStaticMarkup(
      <ChatPanelThinkingGroup
        blocks={[
          { kind: 'thinking', content: '先读取画布', isStreaming: false },
          { kind: 'thinking', content: '再整理节点', isStreaming: true },
        ]}
      />,
    )

    expect(html.match(/<details/g)).toHaveLength(1)
    expect(html).toContain('思考中…')
    expect(html).toContain('2 段')
    expect(html).toContain('先读取画布\n\n再整理节点')
  })

  it('uses a completed label after all segments finish', () => {
    const html = renderToStaticMarkup(
      <ChatPanelThinkingGroup
        blocks={[{ kind: 'thinking', content: '已经完成', isStreaming: false }]}
      />,
    )

    expect(html).toContain('思考过程')
    expect(html).not.toContain('思考中…')
  })
})
