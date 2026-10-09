import { describe, expect, it } from 'vitest'
import type { AgentItem, WorkflowItem } from '@spark/storage'
import { buildManagedAgentSystemPrompt } from './session-workflow-helpers.js'
import {
  buildWorkflowBindingAuthorityPrompt,
  buildWorkflowSystemPrompt,
} from './workflow-system-prompt.js'

function makeAgent(): AgentItem {
  return {
    id: 'agent-host',
    name: 'Host Agent',
    description: 'Coordinates the current session.',
    builtIn: false,
    enabled: true,
    isDefault: false,
    providerProfileId: null,
    modelId: null,
    agentAdapter: 'claude-sdk',
    permissionMode: 'claude-plan',
    reasoningEffort: 'high',
    prompt: 'Keep the response concise.',
    ruleIds: [],
    skillIds: [],
    disabledSkillIds: [],
    mcpServerIds: [],
    hookConfig: {},
    workflowId: null,
    metadata: {},
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
  }
}

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
    bundleId: null,
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
    expect(prompt).toContain('ready agent nodes in parallel waves')
    expect(prompt).toContain('atomic nodes serially')
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

    const prompt = buildWorkflowSystemPrompt(workflow, 'guided')

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

describe('managed Agent workflow prompt baseline', () => {
  it('keeps an Agent without workflow free of workflow instructions', () => {
    expect(buildManagedAgentSystemPrompt(makeAgent(), null)).toBe(
      [
        '[Managed Agent]',
        'Agent: Host Agent (agent-host)',
        'Description: Coordinates the current session.',
        '[Agent Instructions]\nKeep the response concise.',
      ].join('\n\n'),
    )
  })

  it('maps the legacy codex_guided mode onto the workflow_run prompt and keeps guided distinct', () => {
    const prompts = {
      workflow_run: buildManagedAgentSystemPrompt(makeAgent(), makeWorkflow(), 'workflow_run'),
      codex_guided: buildManagedAgentSystemPrompt(makeAgent(), makeWorkflow(), 'codex_guided'),
      guided: buildManagedAgentSystemPrompt(makeAgent(), makeWorkflow(), 'guided'),
    }
    // 历史值 'codex_guided' 不再由解析层产生，兼容映射为 workflow_run 行为
    // （三种执行器的 Host 工具面都挂载 workflow_run）。
    expect(prompts.codex_guided).toBe(prompts.workflow_run)
    expect(prompts.workflow_run).toContain('call `mcp__spark_team__workflow_run` exactly once')
    expect(prompts.guided).toContain('Execute the task by following these workflow nodes in order')
    expect(prompts.guided).not.toContain('workflow_run')
  })
})
