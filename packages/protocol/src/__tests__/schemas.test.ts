import { describe, expect, it } from 'vitest'
import {
  SessionCreateRequestSchema,
  SessionSendTurnRequestSchema,
  SessionUpdateRequestSchema,
} from '../schemas/index.js'

describe('IPC schemas', () => {
  it('does not hard-code runtime permission defaults during session creation', () => {
    const request = SessionCreateRequestSchema.parse({
      providerProfileId: '00000000-0000-4000-8000-000000000001',
    })

    expect(request.agentAdapter).toBeUndefined()
    expect(request.permissionMode).toBeUndefined()
    expect(request.chatMode).toBe('agent')
    expect(request.reasoningEffort).toBe('medium')
  })

  it('preserves selected agent fields during session creation', () => {
    const request = SessionCreateRequestSchema.parse({
      providerProfileId: '00000000-0000-4000-8000-000000000001',
      modelId: 'claude-sonnet-4-20250514',
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      reasoningEffort: 'high',
    })

    expect(request).toMatchObject({
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      reasoningEffort: 'high',
    })
  })

  it('preserves selected agent fields during session updates', () => {
    const request = SessionUpdateRequestSchema.parse({
      sessionId: '00000000-0000-4000-8000-000000000002',
      providerProfileId: '00000000-0000-4000-8000-000000000001',
      modelId: 'claude-sonnet-4-20250514',
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      reasoningEffort: 'high',
    })

    expect(request).toMatchObject({
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      reasoningEffort: 'high',
    })
  })

  it('preserves runtime overrides when sending a turn', () => {
    const request = SessionSendTurnRequestSchema.parse({
      sessionId: '00000000-0000-4000-8000-000000000002',
      message: 'hello',
      providerProfileId: '00000000-0000-4000-8000-000000000001',
      modelId: 'claude-sonnet-4-20250514',
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      chatMode: 'agent',
      reasoningEffort: 'high',
    })

    expect(request).toMatchObject({
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      chatMode: 'agent',
      reasoningEffort: 'high',
    })
  })
})
