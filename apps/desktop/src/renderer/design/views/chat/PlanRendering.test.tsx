import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { UIMessage } from '../../services/event-mapper'
import { PlanSidePanel } from './PlanSidePanel'
import { PlanSummary } from './PlanSummary'

const MarkdownStub = ({ content }: { content: string }) => <article>{content}</article>

describe('plan rendering semantics', () => {
  it('renders a plan proposal from its complete markdown without progress markers', () => {
    const rawPlan = '# 完整方案\n\n## 风险\n\n- 保留这段风险说明'
    const markup = renderToStaticMarkup(
      <PlanSummary
        plan={{
          id: 'proposal-1',
          kind: 'proposal',
          title: 'Agent 方案',
          rawPlan,
        }}
        renderMarkdown={MarkdownStub}
      />,
    )

    expect(markup).toContain(rawPlan)
    expect(markup).not.toContain('inspector-plan-item')
    expect(markup).not.toContain('inspector-progress')
  })

  it('continues to render mutable tool plans as progress items', () => {
    const markup = renderToStaticMarkup(
      <PlanSummary
        plan={{
          id: 'progress-1',
          kind: 'progress',
          title: '执行进度',
          items: [
            { text: '已完成步骤', status: 'done' },
            { text: '正在执行步骤', status: 'running' },
          ],
        }}
        renderMarkdown={MarkdownStub}
      />,
    )

    expect(markup).toContain('已完成步骤')
    expect(markup).toContain('正在执行步骤')
    expect(markup).toContain('inspector-progress')
  })

  it('separates mutable execution progress from immutable proposal history', () => {
    const message: UIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      status: 'completed',
      usage: null,
      eventIds: [],
      blocks: [
        { kind: 'plan_proposed', plan: '# 原始审批方案' },
        {
          kind: 'tool_call',
          toolCallId: 'todo-1',
          toolName: 'todo_write',
          toolInput: { todos: [{ content: '执行测试', status: 'in_progress' }] },
          status: 'success',
          output: undefined,
          error: undefined,
          durationMs: undefined,
        },
      ],
    }
    const markup = renderToStaticMarkup(
      <PlanSidePanel
        session={null}
        messages={[message]}
        proposedPlan={null}
        onClose={() => undefined}
        onClearProposedPlan={() => undefined}
        onPlanApproved={() => undefined}
      />,
    )

    expect(markup).toContain('执行进度')
    expect(markup).toContain('历史方案')
    expect(markup).not.toContain('历史计划')
    expect(markup).toContain('执行测试')
    expect(markup).toContain('原始审批方案')
  })
})
