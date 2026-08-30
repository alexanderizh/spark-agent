import { describe, expect, it } from 'vitest'
import type { UIBlock } from '../services/event-mapper'
import { buildChatPanelRenderItems, getChatPanelTextGroupContent } from './chat-panel-render-items'

function text(
  content: string,
  segmentId: string,
  isStreaming = false,
): Extract<UIBlock, { kind: 'text' }> {
  return { kind: 'text', content, isStreaming, segmentId }
}

function tool(
  toolCallId: string,
  toolName = 'mcp__spark_canvas__canvas_list_nodes',
): Extract<UIBlock, { kind: 'tool_call' }> {
  return {
    kind: 'tool_call',
    toolCallId,
    toolName,
    toolInput: {},
    status: 'success',
    output: undefined,
    error: undefined,
    durationMs: 20,
  }
}

describe('chat panel render items', () => {
  it('groups text made adjacent by the compact tool summary without changing source blocks', () => {
    const blocks: UIBlock[] = [
      text('开始读取画布。', 'text-1'),
      tool('tool-1'),
      text('已经拿到节点详情。', 'text-2'),
      tool('tool-2'),
      text('现在开始生成工作流。', 'text-3', true),
    ]

    const items = buildChatPanelRenderItems(blocks, {
      toolCallDisplay: 'summary',
      toolNamePrefix: 'mcp__spark_canvas__',
    })

    expect(items.map((item) => item.kind)).toEqual(['text_group', 'tool_activity', 'text_group'])
    expect(items[0]).toMatchObject({ kind: 'text_group', blocks: [{ segmentId: 'text-1' }] })
    expect(items[1]).toMatchObject({
      kind: 'tool_activity',
      blocks: [{ toolCallId: 'tool-1' }, { toolCallId: 'tool-2' }],
    })
    expect(items[2]).toMatchObject({
      kind: 'text_group',
      blocks: [{ segmentId: 'text-2' }, { segmentId: 'text-3', isStreaming: true }],
    })
    expect(blocks).toHaveLength(5)
  })

  it('keeps errors and interactive blocks as visual boundaries between text groups', () => {
    const blocks: UIBlock[] = [
      text('第一段', 'text-1'),
      {
        kind: 'error',
        code: 'CANVAS_FAILED',
        message: '画布读取失败',
        retryable: true,
      },
      text('第二段', 'text-2'),
    ]

    const items = buildChatPanelRenderItems(blocks, { toolCallDisplay: 'summary' })

    expect(items.map((item) => item.kind)).toEqual(['text_group', 'block', 'text_group'])
  })

  it('preserves the original block timeline in full tool mode', () => {
    const items = buildChatPanelRenderItems(
      [text('调用前', 'text-1'), tool('tool-1'), text('调用后', 'text-2')],
      { toolCallDisplay: 'full' },
    )

    expect(items.map((item) => item.kind)).toEqual(['block', 'block', 'block'])
  })

  it('joins grouped segments as markdown paragraphs for one continuous reading surface', () => {
    expect(
      getChatPanelTextGroupContent([
        text('已经拿到图片路径。', 'text-1'),
        text('接下来分析风格。', 'text-2'),
      ]),
    ).toBe('已经拿到图片路径。\n\n接下来分析风格。')
  })
})
