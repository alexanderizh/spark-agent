import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import {
  buildConversationHistoryPromptFromEvents,
  createCodexExecutorForConfig,
  createInterruptedTurnEvents,
  isSdkResumeSafe,
  makeSdkRuntimeSessionId,
} from '../../services/session.service.js'
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
