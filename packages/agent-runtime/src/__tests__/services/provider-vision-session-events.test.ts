import { describe, expect, it } from 'vitest'
import {
  createProviderVisionSessionEvents,
  HOST_PROVIDER_VISION_TOOL_NAME,
} from '../../services/custom-tools/provider-vision-session-events.js'

describe('createProviderVisionSessionEvents', () => {
  it('creates a redacted call/result pair with a trace link', () => {
    const ids = ['call-event', 'result-event']
    const events = createProviderVisionSessionEvents({
      route: {
        status: 'succeeded',
        message: 'executor prompt containing private observation',
        attachments: [],
        toolId: 'vision_fallback',
        toolTitle: '图像理解',
        traceId: 42,
        imageCount: 2,
        durationMs: 1_234,
        targetOrigin: 'https://vision.example.com',
        model: 'qwen-vl',
      },
      sessionId: 'session-1',
      turnId: 'turn-1',
      now: () => '2026-08-31T00:00:00.000Z',
      idFactory: () => ids.shift() ?? 'unexpected',
    })

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      id: 'call-event',
      type: 'tool_call',
      toolName: HOST_PROVIDER_VISION_TOOL_NAME,
      toolInput: {
        route: 'host-deterministic',
        reason: 'text-model-with-image-attachments',
        imageCount: 2,
        toolId: 'vision_fallback',
        toolTitle: '图像理解',
        targetOrigin: 'https://vision.example.com',
        model: 'qwen-vl',
      },
    })
    expect(events[1]).toMatchObject({
      id: 'result-event',
      type: 'tool_result',
      status: 'success',
      durationMs: 1_234,
      output: { traceId: 42, toolId: 'vision_fallback' },
    })
    expect(JSON.stringify(events)).not.toContain('private observation')
    expect(JSON.stringify(events)).not.toContain('/Users/')
  })

  it('records a deterministic failure without inventing tool details', () => {
    const events = createProviderVisionSessionEvents({
      route: {
        status: 'failed',
        errorCode: 'NO_TOOL',
        imageCount: 1,
        message: 'not exposed',
        attachments: [],
      },
      sessionId: 'session-1',
      turnId: 'turn-1',
      idFactory: () => 'event-id',
    })

    expect(events[0]).toMatchObject({
      type: 'tool_call',
      toolInput: { imageCount: 1 },
    })
    expect(events[1]).toMatchObject({
      type: 'tool_result',
      status: 'error',
      error: '没有可用的自动路由图像理解工具',
    })
  })

  it('keeps failed execution trace metadata navigable without exposing observations', () => {
    const events = createProviderVisionSessionEvents({
      route: {
        status: 'failed',
        errorCode: 'EXECUTION_FAILED',
        message: 'executor prompt containing private observation',
        attachments: [],
        toolId: 'vision_fallback',
        traceId: 43,
        imageCount: 1,
        targetOrigin: 'https://vision.example.com',
        model: 'qwen-vl',
      },
      sessionId: 'session-1',
      turnId: 'turn-1',
      idFactory: () => 'event-id',
    })

    expect(events[1]).toMatchObject({
      type: 'tool_result',
      status: 'error',
      output: {
        status: 'failed',
        route: 'host-deterministic',
        toolId: 'vision_fallback',
        traceId: 43,
        targetOrigin: 'https://vision.example.com',
        model: 'qwen-vl',
      },
    })
    expect(JSON.stringify(events)).not.toContain('private observation')
  })

  it('does not create events for native multimodal or attachment-free turns', () => {
    expect(
      createProviderVisionSessionEvents({
        route: { status: 'not-applicable', message: 'hello', attachments: [] },
        sessionId: 'session-1',
        turnId: 'turn-1',
      }),
    ).toEqual([])
  })
})
