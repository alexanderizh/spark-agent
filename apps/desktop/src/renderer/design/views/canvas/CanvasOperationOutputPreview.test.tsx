import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../chat/ChatMarkdown', () => ({ MarkdownText: 'div' }))

import { CanvasOperationOutputList } from './CanvasOperationOutputPreview'
import type { CanvasOperationOutputView } from './canvasOperationRuns'

const at = '2026-07-15T00:00:00.000Z'

function characterOutput(id: string, title: string): CanvasOperationOutputView {
  return {
    id,
    type: 'text',
    title,
    text: `${title}的角色设定描述`,
    pipelineRole: 'character',
    createdAt: at,
    updatedAt: at,
  }
}

describe('CanvasOperationOutputList', () => {
  it('在同一节点中按列表展示全部角色产物及数量', () => {
    const html = renderToStaticMarkup(
      <CanvasOperationOutputList
        outputs={[
          characterOutput('character-1', '苏烬'),
          characterOutput('character-2', '林雾'),
          characterOutput('character-3', '陈默'),
        ]}
      />,
    )

    expect(html).toContain('3 个角色')
    expect(html).toContain('苏烬')
    expect(html).toContain('林雾')
    expect(html).toContain('陈默')
    expect(html.match(/class="canvas-operation-output-list-item"/g)).toHaveLength(3)
  })

  it('为角色结果标记角色语义，供角色图标与样式使用', () => {
    const html = renderToStaticMarkup(
      <CanvasOperationOutputList outputs={[characterOutput('character-1', '苏烬')]} />,
    )

    expect(html).toContain('data-output-role="character"')
  })
})
