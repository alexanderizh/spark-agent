import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkflowLoopBodySummary } from './WorkflowLoopBodySummary'

describe('WorkflowLoopBodySummary', () => {
  it('shows graph counts, orientation, visual entry and advanced JSON', () => {
    const html = renderToStaticMarkup(
      <WorkflowLoopBodySummary
        summary={{
          nodeCount: 2,
          edgeCount: 1,
          conditionalEdgeCount: 1,
          orientation: 'vertical',
        }}
        jsonDraft={'{"nodes":[],"edges":[]}'}
        jsonError=""
        onOpen={() => undefined}
        onReset={() => undefined}
        onJsonChange={() => undefined}
      />,
    )

    expect(html).toContain('2 个节点')
    expect(html).toContain('1 条连线')
    expect(html).toContain('1 条条件边')
    expect(html).toContain('纵向')
    expect(html).toContain('编辑循环体')
    expect(html).toContain('高级 JSON')
  })

  it('shows JSON errors without hiding the visual editor action', () => {
    const html = renderToStaticMarkup(
      <WorkflowLoopBodySummary
        summary={{
          nodeCount: 0,
          edgeCount: 0,
          conditionalEdgeCount: 0,
          orientation: 'horizontal',
        }}
        jsonDraft="{"
        jsonError="JSON 解析失败"
        onOpen={() => undefined}
        onReset={() => undefined}
        onJsonChange={() => undefined}
      />,
    )

    expect(html).toContain('JSON 解析失败')
    expect(html).toContain('编辑循环体')
    expect(html).toContain('横向')
  })
})
