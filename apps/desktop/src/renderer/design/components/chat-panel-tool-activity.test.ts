import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { UIBlock } from '../services/event-mapper'
import { ChatPanelToolActivity } from './ChatPanelToolActivity'
import {
  extractCanvasNodeIds,
  getChatPanelToolBlocks,
  getChatPanelToolLabel,
  isCanvasMutationTool,
} from './chat-panel-tool-activity'

const toolBlock = (patch: Partial<Extract<UIBlock, { kind: 'tool_call' }>> = {}) =>
  ({
    kind: 'tool_call',
    toolCallId: 'tool-1',
    toolName: 'mcp__spark_canvas__canvas_patch_nodes',
    toolInput: { nodeIds: ['node-a', 'node-b'] },
    status: 'success',
    output: JSON.stringify({ updatedNodeId: 'node-c' }),
    error: undefined,
    durationMs: 120,
    ...patch,
  }) satisfies Extract<UIBlock, { kind: 'tool_call' }>

describe('chat panel tool activity', () => {
  it('filters the activity stream to canvas tools', () => {
    const blocks: UIBlock[] = [
      toolBlock(),
      toolBlock({ toolCallId: 'tool-2', toolName: 'mcp__other__read_file' }),
    ]
    expect(getChatPanelToolBlocks(blocks, 'mcp__spark_canvas__')).toHaveLength(1)
  })

  it('uses readable labels and distinguishes read-only from mutation tools', () => {
    expect(getChatPanelToolLabel('mcp__spark_canvas__canvas_patch_nodes')).toBe('更新节点属性')
    expect(isCanvasMutationTool('mcp__spark_canvas__canvas_patch_nodes')).toBe(true)
    expect(isCanvasMutationTool('mcp__spark_canvas__canvas_list_nodes')).toBe(false)
  })

  it('extracts unique node ids from tool input and output', () => {
    expect(extractCanvasNodeIds(toolBlock())).toEqual(['node-a', 'node-b', 'node-c'])
  })

  it('renders multiple tool calls as one compact canvas activity section', () => {
    const html = renderToStaticMarkup(
      createElement(ChatPanelToolActivity, {
        blocks: [toolBlock(), toolBlock({ toolCallId: 'tool-2', status: 'running' })],
      }),
    )
    expect(html.match(/chat-panel-tool-activity"/g)).toHaveLength(1)
    expect(html).toContain('画布执行')
    expect(html).toContain('正在执行 · 1/2')
  })
})
