import { describe, expect, it } from 'vitest'
import type { WorkflowItem } from '@spark/storage'
import {
  buildWorkflowBindingAuthorityPrompt,
  buildWorkflowSystemPrompt,
} from './workflow-system-prompt.js'

function makeWorkflow(): WorkflowItem {
  return {
    id: 'workflow-new',
    scope: 'user',
    name: 'New approval workflow',
    version: '1.0.0',
    description: 'The newly selected workflow.',
    status: 'active',
    tags: [],
    enabled: true,
    graph: {
      nodes: [
        {
          id: 'plan',
          kind: 'plan',
          title: 'New plan step',
          config: { prompt: 'Use the new plan.' },
        },
      ],
      edges: [],
    },
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  }
}

describe('buildWorkflowSystemPrompt', () => {
  it('renders the selected workflow execution plan', () => {
    const prompt = buildWorkflowSystemPrompt(makeWorkflow(), 'workflow_run')

    expect(prompt).toContain('Workflow: New approval workflow (workflow-new)')
    expect(prompt).toContain('1. New plan step [kind=plan]')
  })

  it('renders workflow edges and conditions for guided runtimes', () => {
    const workflow = makeWorkflow()
    workflow.graph = {
      nodes: [
        {
          id: 'route',
          kind: 'plan',
          title: 'Route',
          config: { prompt: 'Choose a route.', outputKey: 'route' },
        },
        {
          id: 'deep',
          kind: 'agent',
          title: 'Deep implementation',
          config: { outputKey: 'implementation' },
        },
      ],
      edges: [
        {
          id: 'route-deep',
          from: 'route',
          to: 'deep',
          condition: { op: 'equals', key: 'route', value: 'deep' },
        },
      ],
    }

    const prompt = buildWorkflowSystemPrompt(workflow, 'codex_guided')

    expect(prompt).toContain('Route [kind=plan; outputKey=route]')
    expect(prompt).toContain('[Workflow Edges]')
    expect(prompt).toContain('- Route -> Deep implementation [condition: route equals "deep"]')
  })

  it('limits binding precedence to workflow conflicts and preserves unrelated prompt layers', () => {
    const prompt = buildWorkflowBindingAuthorityPrompt(makeWorkflow())

    expect(prompt).toContain(
      'The only active workflow binding for this turn is New approval workflow (workflow-new).',
    )
    expect(prompt).toContain('Only for workflow identity and execution steps')
    expect(prompt).toContain(
      'All unrelated system, agent, project, session, and user instructions remain in force.',
    )
    expect(prompt).toContain('When asked which workflow you use, report this workflow only.')
  })

  it('does not claim authority for an empty workflow graph', () => {
    const workflow = makeWorkflow()
    workflow.graph = { nodes: [], edges: [] }

    expect(buildWorkflowBindingAuthorityPrompt(workflow)).toBe('')
    expect(buildWorkflowSystemPrompt(workflow, 'workflow_run')).toBe('')
  })
})
