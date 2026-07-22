import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkflowContextMenu } from './WorkflowContextMenu'

describe('WorkflowContextMenu', () => {
  it('disables nested loop creation in a loop body scope', () => {
    const html = renderToStaticMarkup(
      <WorkflowContextMenu
        menu={{ kind: 'pane', flowX: 100, flowY: 100, left: 20, top: 20 }}
        disabledNodeKinds={new Set(['loop'])}
        onClose={() => undefined}
        onDuplicateNode={() => undefined}
        onDeleteNode={() => undefined}
        onConfigureEdge={() => undefined}
        onDeleteEdge={() => undefined}
        onAddNode={() => undefined}
      />,
    )

    expect(html).toMatch(
      /<button[^>]+disabled=""[^>]*title="运行时 v1 不支持嵌套循环"[^>]*>[^]*循环/,
    )
  })
})
