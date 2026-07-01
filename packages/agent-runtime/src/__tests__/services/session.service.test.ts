import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import type { TeamA2ATask } from '@spark/protocol'
import {
  buildConversationHistoryPromptFromEvents,
  buildMemberUserMessage,
  createCodexExecutorForConfig,
  createInterruptedTurnEvents,
  hasWorkflowExecutableNodes,
  isSdkResumeSafe,
  makeSdkRuntimeSessionId,
  mapSessionAttachmentsToDispatch,
} from '../../services/session.service.js'
import { normalizeWorkflowGraph } from '../../services/workflow-executor.js'
import { CodexCliExecutor, CodexOpenAIExecutor, CodexSdkExecutor } from '../../sdk/index.js'

function baseEvent(sessionId: string, turnId: string, seq: number): Pick<AgentEvent, 'id' | 'sessionId' | 'turnId' | 'timestamp' | 'seq'> {
  return {
    id: `event-${seq}`,
    sessionId,
    turnId,
    timestamp: '2026-05-28T00:00:00.000Z',
    seq,
  }
}

describe('SessionService recovery helpers', () => {
  it('routes bare Codex chat-compatible API configs through the OpenAI Chat executor', () => {
    expect(createCodexExecutorForConfig({ codexApiKind: 'chat' })).toBeInstanceOf(CodexOpenAIExecutor)
  })

  it('routes OpenAI-compatible Codex provider configs through the Codex CLI executor for tool access', () => {
    expect(createCodexExecutorForConfig({
      codexApiKind: 'chat',
      codexCliProvider: {
        id: 'spark-provider',
        wireApi: 'chat',
        envKey: 'SPARK_CODEX_API_KEY_TEST',
        env: { SPARK_CODEX_API_KEY_TEST: 'sk-test' },
      },
    })).toBeInstanceOf(CodexCliExecutor)
  })

  it('keeps Codex Responses providers on the Codex SDK executor', () => {
    expect(createCodexExecutorForConfig({ codexApiKind: 'responses' })).toBeInstanceOf(CodexSdkExecutor)
    expect(createCodexExecutorForConfig({})).toBeInstanceOf(CodexSdkExecutor)
  })

  it('keeps local Codex CLI providers on the CLI executor', () => {
    expect(createCodexExecutorForConfig({ useLocalConfig: true, codexApiKind: 'chat' })).toBeInstanceOf(CodexCliExecutor)
  })

  it('creates terminal events for a turn interrupted by app restart', () => {
    const events = createInterruptedTurnEvents('session-1', 'turn-1', 7, '2026-05-28T00:00:00.000Z')

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual(expect.objectContaining({
      type: 'agent_error',
      sessionId: 'session-1',
      turnId: 'turn-1',
      seq: 7,
      code: 'APP_RESTARTED',
      retryable: true,
    }))
    expect(events[1]).toEqual(expect.objectContaining({
      type: 'agent_status',
      sessionId: 'session-1',
      turnId: 'turn-1',
      seq: 8,
      status: 'cancelled',
    }))
  })

  it('builds a compact system prompt from persisted dialogue events', () => {
    const prompt = buildConversationHistoryPromptFromEvents([
      {
        ...baseEvent('session-1', 'turn-1', 0),
        type: 'user_message',
        content: 'Earlier user request about database indexes',
      },
      {
        ...baseEvent('session-1', 'turn-1', 1),
        type: 'assistant_message',
        mode: 'complete',
        content: 'Earlier assistant answer mentioning idx_sessions_updated_at',
        provider: 'claude',
        isFinal: true,
      },
      {
        ...baseEvent('session-1', 'turn-2', 2),
        type: 'agent_status',
        status: 'completed',
      },
    ])

    expect(prompt).toContain('[Spark Session History]')
    expect(prompt).toContain('Earlier user request about database indexes')
    expect(prompt).toContain('idx_sessions_updated_at')
    expect(prompt).not.toContain('completed')
  })

  it('recovers user turns from prompt snapshots when SDK did not persist user_message events', () => {
    const prompt = buildConversationHistoryPromptFromEvents([
      {
        ...baseEvent('session-1', 'turn-1', 0),
        type: 'turn_prompt_snapshot',
        userMessage: 'Earlier user request about the resume bug',
        systemPromptSections: [],
        model: 'glm-5',
        adapterKind: 'claude-sdk',
        permissionMode: 'claude-plan',
        toolCount: 12,
      },
      {
        ...baseEvent('session-1', 'turn-1', 1),
        type: 'assistant_message',
        mode: 'complete',
        content: 'Earlier assistant answer about Spark Session History',
        provider: 'claude',
        isFinal: true,
      },
    ])

    expect(prompt).toContain('Earlier user request about the resume bug')
    expect(prompt).toContain('Earlier assistant answer about Spark Session History')
  })

  it('keeps SDK resume disabled while persisted history provides continuity', () => {
    expect(isSdkResumeSafe({
      providerType: 'anthropic',
      model: 'claude-sonnet-4-5',
      agentAdapter: 'claude-sdk',
    })).toBe(false)

    expect(isSdkResumeSafe({
      providerType: 'anthropic',
      apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
      model: 'glm-5',
      agentAdapter: 'claude-sdk',
    })).toBe(false)

    expect(isSdkResumeSafe({
      providerType: 'anthropic',
      apiEndpoint: 'https://api.anthropic.com/v1',
      model: 'glm-5',
      agentAdapter: 'claude-sdk',
    })).toBe(false)
  })

  it('generates unique SDK session ids for fresh turns when resume is disabled', () => {
    const stable = makeSdkRuntimeSessionId('spark-session', 'provider-1', 'glm-5', 'claude-sdk')
    const firstTurn = makeSdkRuntimeSessionId('spark-session', 'provider-1', 'glm-5', 'claude-sdk', 'turn-1')
    const secondTurn = makeSdkRuntimeSessionId('spark-session', 'provider-1', 'glm-5', 'claude-sdk', 'turn-2')

    expect(firstTurn).not.toBe(stable)
    expect(secondTurn).not.toBe(stable)
    expect(secondTurn).not.toBe(firstTurn)
    expect(firstTurn).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('buildMemberUserMessage (agent_dispatch / workflow_run inputs delivery)', () => {
  const baseTask: TeamA2ATask = {
    taskId: 'task-1',
    hostAgentId: 'host',
    memberAgentId: 'member',
    rootTurnId: 'turn-1',
    instruction: 'Implement the feature.',
  }

  it('renders task.inputs into the member-visible prompt', () => {
    // Regression for a real bug found while wiring up workflow_run's outputKey → inputs
    // chaining: buildWorkflowNodeInputs computes the upstream node's output and attaches it
    // to TeamA2ATask.inputs, but the dispatched member never actually saw it — this function
    // dropped the field entirely, so multi-node state passing was silently inert.
    const message = buildMemberUserMessage({
      ...baseTask,
      inputs: { impact_analysis: 'Touches src/auth.ts and its 3 callers.' },
    })
    expect(message).toContain('[Inputs]')
    expect(message).toContain('impact_analysis')
    expect(message).toContain('Touches src/auth.ts and its 3 callers.')
  })

  it('omits the [Inputs] section when inputs is absent or empty', () => {
    expect(buildMemberUserMessage(baseTask)).not.toContain('[Inputs]')
    expect(buildMemberUserMessage({ ...baseTask, inputs: {} })).not.toContain('[Inputs]')
  })

  it('renders file_ref/image_ref attachments with a Read-tool instruction', () => {
    const message = buildMemberUserMessage({
      ...baseTask,
      attachments: [
        { type: 'image_ref', value: '/tmp/screenshot.png' },
        { type: 'file_ref', value: '/tmp/spec.md' },
      ],
    })
    expect(message).toContain('[Attachments]')
    expect(message).toContain('image_ref: /tmp/screenshot.png')
    expect(message).toContain('file_ref: /tmp/spec.md')
    expect(message).toContain('Use the Read tool')
  })
})

describe('mapSessionAttachmentsToDispatch (workflow_run attachment passthrough)', () => {
  it('maps session attachments to dispatch attachment refs by path, not content', () => {
    // Regression for a real gap: workflow_run dispatched nodes previously had no channel
    // at all for the attachments (images/files) the user attached to the triggering message
    // — WorkflowAgentDispatchRequest didn't even have an `attachments` field. Members can
    // read the shared workspace filesystem, so passing the path (same as the host's own
    // buildPromptWithAttachments does) is sufficient — no need to smuggle binary content.
    const result = mapSessionAttachmentsToDispatch([
      { type: 'image', path: '/tmp/screenshot.png' },
      { type: 'file', path: '/tmp/spec.md' },
      { type: 'directory', path: '/tmp/assets' },
    ])
    expect(result).toEqual([
      { type: 'image_ref', value: '/tmp/screenshot.png' },
      { type: 'file_ref', value: '/tmp/spec.md' },
      { type: 'file_ref', value: '/tmp/assets' },
    ])
  })
})

describe('hasWorkflowExecutableNodes (orchestrator-host gating)', () => {
  // Real graph shipped by migration 041 for the built-in 全栈开发标准流程 workflow:
  // 6 kind:"agent" nodes with role/prompt filled in but no config.agentId — the host
  // walks all phases itself in one continuous turn (guided mode), it never dispatches.
  const guidedFullstackWorkflowGraph = {
    nodes: [
      { id: 'n1', kind: 'agent', title: '需求理解', config: { role: '需求分析', prompt: '...' } },
      { id: 'n2', kind: 'agent', title: '影响分析', config: { role: '影响评估', prompt: '...' } },
      { id: 'n3', kind: 'agent', title: '方案设计', config: { role: '方案设计', prompt: '...' } },
      { id: 'n4', kind: 'agent', title: '编码实现', config: { role: '编码实现', prompt: '...' } },
      { id: 'n5', kind: 'agent', title: '测试修复', config: { role: '测试与修复', prompt: '...' } },
      { id: 'n6', kind: 'agent', title: '验证交付', config: { role: '验证交付', prompt: '...' } },
    ],
    edges: [],
  }

  it('does not classify a guided (single-agent, no dispatch) workflow as executable', () => {
    // This is the exact bug scenario reported live: attaching this workflow to an agent
    // must NOT flip the session into orchestrator-host mode (which would strip
    // Edit/Write/Bash via ORCHESTRATOR_HOST_DISALLOWED_TOOLS) — the host is expected to
    // edit files directly while working through the guided phases.
    const graph = normalizeWorkflowGraph(guidedFullstackWorkflowGraph)
    expect(hasWorkflowExecutableNodes(graph)).toBe(false)
  })

  it('classifies a workflow as executable once a kind:"agent" node binds a real agentId', () => {
    const graph = normalizeWorkflowGraph({
      nodes: [{ id: 'n1', kind: 'agent', title: 'Review', config: { agentId: 'qa-agent' } }],
      edges: [],
    })
    expect(hasWorkflowExecutableNodes(graph, new Set(['qa-agent']))).toBe(true)
  })

  it('classifies a workflow as executable when it has a kind:"subagent" dispatch node', () => {
    const graph = normalizeWorkflowGraph({
      nodes: [{ id: 'n1', kind: 'subagent', title: 'Review', config: {} }],
      edges: [],
    })
    expect(hasWorkflowExecutableNodes(graph)).toBe(true)
  })
})
