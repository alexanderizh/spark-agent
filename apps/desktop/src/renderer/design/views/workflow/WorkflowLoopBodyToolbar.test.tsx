import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkflowLoopBodyToolbar } from './WorkflowLoopBodyToolbar'

describe('WorkflowLoopBodyToolbar', () => {
  it('shows the parent workflow, loop title and return action', () => {
    const html = renderToStaticMarkup(
      <WorkflowLoopBodyToolbar
        workflowName="编码流程"
        loopTitle="实现与自检"
        onBack={() => undefined}
      />,
    )

    expect(html).toContain('返回主工作流')
    expect(html).toContain('编码流程')
    expect(html).toContain('实现与自检')
    expect(html).toContain('循环体')
  })
})
