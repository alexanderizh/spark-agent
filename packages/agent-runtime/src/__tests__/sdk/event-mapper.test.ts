import { describe, expect, it } from 'vitest'

import { mapSDKMessageToEvents } from '../../sdk/event-mapper.js'
import type { SDKMessage } from '../../sdk/types.js'

const ctx = { sessionId: 'session-1', turnId: 'turn-1' }

describe('Claude SDK event mapper', () => {
  it('maps Claude Code compact status messages from real SDK fields', () => {
    const started = mapSDKMessageToEvents({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      uuid: 'status-1',
      session_id: 'session-1',
    } as SDKMessage, ctx)
    const completed = mapSDKMessageToEvents({
      type: 'system',
      subtype: 'status',
      status: null,
      compact_result: 'success',
      uuid: 'status-2',
      session_id: 'session-1',
    } as SDKMessage, ctx)

    expect(started).toContainEqual(expect.objectContaining({
      type: 'context_compaction',
      provider: 'claude',
      source: 'claude_code',
      phase: 'started',
      rawType: 'system/status',
    }))
    expect(completed).toContainEqual(expect.objectContaining({
      type: 'context_compaction',
      provider: 'claude',
      source: 'claude_code',
      phase: 'completed',
      rawType: 'system/status',
    }))
  })

  it('maps Claude Code compact boundary metadata without inventing a summary', () => {
    const events = mapSDKMessageToEvents({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: {
        trigger: 'auto',
        pre_tokens: 180_000,
        post_tokens: 48_000,
        duration_ms: 1234,
      },
      uuid: 'compact-1',
      session_id: 'session-1',
    } as SDKMessage, ctx)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'context_compaction',
      provider: 'claude',
      source: 'claude_code',
      phase: 'boundary',
      trigger: 'auto',
      preTokens: 180_000,
      postTokens: 48_000,
      durationMs: 1234,
      rawType: 'system/compact_boundary',
    }))
    expect(events[0]).not.toHaveProperty('summary')
  })
})
