// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TeamA2ATask } from '@spark/protocol'
import type { UIBlock } from '../../../services/event-mapper'
import {
  WorkflowAtomicDispatchView,
  WorkflowAtomicNodeMetaProvider,
  buildWorkflowAtomicNodeMetaIndex,
  isWorkflowAtomicMemberId,
  parseWorkflowAtomicNodeId,
  wrapWorkflowAtomicJsonContent,
} from './WorkflowAtomicViews'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function atomicDispatchBlock(options: {
  nodeId: string
  state: 'pending' | 'working' | 'completed' | 'failed' | 'canceled'
  reply?: { content: string; errorMessage?: string }
}): Extract<UIBlock, { kind: 'team_dispatch' }> {
  const task: TeamA2ATask = {
    taskId: 'task-1',
    hostAgentId: 'host',
    memberAgentId: `workflow-atomic:${options.nodeId}`,
    rootTurnId: 'turn-1',
    instruction: '梳理审计目标并输出结构化 JSON。',
  }
  const block: Extract<UIBlock, { kind: 'team_dispatch' }> = {
    kind: 'team_dispatch',
    dispatchId: 'dispatch-1',
    hostAgentId: 'host',
    memberAgentId: task.memberAgentId,
    task,
    state: options.state,
  }
  if (options.reply != null) {
    const reply: import('@spark/protocol').TeamA2AReply = {
      taskId: task.taskId,
      memberAgentId: task.memberAgentId,
      state: 'completed',
      content: options.reply.content,
    }
    if (options.reply.errorMessage != null) {
      reply.error = { code: 'internal', message: options.reply.errorMessage }
    }
    block.reply = reply
  }
  return block
}

function workflowProgressBlock(
  nodes: Array<{ nodeId: string; title: string; kind: string }>,
): Extract<UIBlock, { kind: 'workflow_progress' }> {
  return {
    kind: 'workflow_progress',
    workflowId: 'workflow-a',
    runId: 'run-1',
    runStatus: 'working',
    nodes: nodes.map((node) => ({
      nodeId: node.nodeId,
      title: node.title,
      kind: node.kind,
      status: 'running',
    })),
  }
}

describe('workflow atomic member id', () => {
  it('only matches the workflow-atomic synthetic prefix', () => {
    expect(isWorkflowAtomicMemberId('workflow-atomic:input-requirement')).toBe(true)
    expect(parseWorkflowAtomicNodeId('workflow-atomic:input-requirement')).toBe('input-requirement')
    // 真实团队成员 / AutoRouter worker / subagent 均不命中
    expect(isWorkflowAtomicMemberId('platform-manager-agent')).toBe(false)
    expect(isWorkflowAtomicMemberId('auto-router-worker-3')).toBe(false)
    expect(isWorkflowAtomicMemberId('workflow-subagent:node-1')).toBe(false)
    expect(parseWorkflowAtomicMemberIdFallback()).toBe(null)
  })

  function parseWorkflowAtomicMemberIdFallback(): string | null {
    return parseWorkflowAtomicNodeId('workflow-atomic:')
  }
})

describe('wrapWorkflowAtomicJsonContent', () => {
  it('wraps strict JSON objects and arrays into a json fence', () => {
    expect(wrapWorkflowAtomicJsonContent('{"objective":"审计"}')).toBe(
      '```json\n{"objective":"审计"}\n```',
    )
    expect(wrapWorkflowAtomicJsonContent('  [1, 2, 3]  ')).toBe('```json\n[1, 2, 3]\n```')
  })

  it('keeps non-JSON, invalid JSON, fenced and empty content untouched', () => {
    expect(wrapWorkflowAtomicJsonContent('普通文本结论')).toBe('普通文本结论')
    expect(wrapWorkflowAtomicJsonContent('{"objective": 未闭合}')).toBe('{"objective": 未闭合}')
    expect(wrapWorkflowAtomicJsonContent('```json\n{"a":1}\n```')).toBe('```json\n{"a":1}\n```')
    expect(wrapWorkflowAtomicJsonContent('   ')).toBe('   ')
    // JSON 标量虽是合法 JSON，包成 json 代码块毫无信息量：首字符必须是 { 或 [
    expect(wrapWorkflowAtomicJsonContent('123')).toBe('123')
    expect(wrapWorkflowAtomicJsonContent('true')).toBe('true')
    expect(wrapWorkflowAtomicJsonContent('"工作流已收口"')).toBe('"工作流已收口"')
  })
})

describe('buildWorkflowAtomicNodeMetaIndex', () => {
  it('indexes nodes from workflow_progress blocks only', () => {
    const blocks: UIBlock[] = [
      workflowProgressBlock([
        { nodeId: 'input-requirement', title: '明确审计目标', kind: 'input' },
        { nodeId: 'plan-audit', title: '输出审计计划', kind: 'plan' },
      ]),
      atomicDispatchBlock({ nodeId: 'input-requirement', state: 'completed' }),
    ]
    const index = buildWorkflowAtomicNodeMetaIndex(blocks)
    expect(index.get('input-requirement')).toEqual({
      nodeId: 'input-requirement',
      title: '明确审计目标',
      kind: 'input',
    })
    expect(index.size).toBe(2)
    expect(buildWorkflowAtomicNodeMetaIndex([]).size).toBe(0)
  })
})

describe('WorkflowAtomicDispatchView', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    document.body.innerHTML = ''
  })

  function render(node: React.ReactNode): void {
    act(() => {
      root = createRoot(container)
      root.render(node)
    })
  }

  it('stays collapsed while running and shows node title from progress meta', () => {
    const block = atomicDispatchBlock({ nodeId: 'input-requirement', state: 'working' })
    render(
      <WorkflowAtomicNodeMetaProvider
        blocks={[
          workflowProgressBlock([
            { nodeId: 'input-requirement', title: '明确审计目标', kind: 'input' },
          ]),
          block,
        ]}
      >
        <WorkflowAtomicDispatchView block={block} />
      </WorkflowAtomicNodeMetaProvider>,
    )

    expect(container.textContent).toContain('明确审计目标')
    expect(container.textContent).toContain('输入解析')
    // 运行中也保持收起：不渲染完整指令
    expect(container.querySelector('.workflow-atomic-dispatch-detail')).toBeNull()
    expect(container.querySelector('.workflow-atomic-dispatch-spinner')).not.toBeNull()
    expect(container.textContent).toContain('梳理审计目标并输出结构化 JSON。')
  })

  it('falls back to a readable node name without progress meta', () => {
    const block = atomicDispatchBlock({ nodeId: 'plan-audit', state: 'completed' })
    render(<WorkflowAtomicDispatchView block={block} />)

    expect(container.textContent).toContain('节点 plan-audit')
    expect(container.querySelector('.workflow-atomic-dispatch-kind')).toBeNull()
  })

  it('expands full instruction on click and collapses again', () => {
    const block = atomicDispatchBlock({
      nodeId: 'plan-audit',
      state: 'completed',
      reply: { content: '计划已生成' },
    })
    render(<WorkflowAtomicDispatchView block={block} />)

    const head = container.querySelector<HTMLButtonElement>('.workflow-atomic-dispatch-head')
    expect(head).not.toBeNull()

    act(() => head?.click())
    expect(container.querySelector('.workflow-atomic-dispatch-instruction')?.textContent).toBe(
      '梳理审计目标并输出结构化 JSON。',
    )

    act(() => head?.click())
    expect(container.querySelector('.workflow-atomic-dispatch-detail')).toBeNull()
  })

  it('surfaces the reply error for failed nodes when expanded', () => {
    const block = atomicDispatchBlock({
      nodeId: 'plan-audit',
      state: 'failed',
      reply: { content: '', errorMessage: '节点执行超时' },
    })
    render(<WorkflowAtomicDispatchView block={block} />)

    expect(container.querySelector('.workflow-atomic-dispatch-state.is-failed')).not.toBeNull()
    const head = container.querySelector<HTMLButtonElement>('.workflow-atomic-dispatch-head')
    act(() => head?.click())
    expect(container.querySelector('.workflow-atomic-dispatch-error')?.textContent).toBe(
      '节点执行超时',
    )
  })
})
