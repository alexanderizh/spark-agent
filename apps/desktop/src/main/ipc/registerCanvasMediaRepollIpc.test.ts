import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaTaskRecord } from '@spark/agent-runtime'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: any) => Promise<any>>(),
  events: [] as Array<{ channel: string; payload: any }>,
  recover: vi.fn(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: any) => Promise<any>) => {
    harness.handlers.set(channel, handler)
  },
  pushStreamEvent: (channel: string, payload: any) => harness.events.push({ channel, payload }),
}))

vi.mock('@spark/agent-runtime', () => ({
  MediaTaskRuntimeService: class {},
  recoverMediaTask: (...args: any[]) => harness.recover(...args),
}))

import { registerCanvasMediaRepollIpc } from './registerCanvasMediaRepollIpc.js'

describe('registerCanvasMediaRepollIpc', () => {
  beforeEach(() => {
    harness.handlers.clear()
    harness.events.length = 0
    harness.recover.mockReset()
  })

  it('resumes an existing task through the protocol-specific recovery service', async () => {
    harness.recover.mockResolvedValue({
      status: 'succeeded',
      provider: 'volcengine-ark',
      model: 'seedance',
      assets: [{ type: 'video', filePath: '/tmp/recovered.mp4' }],
      rawResponse: { status: 'succeeded' },
    })
    const record = failedRecord()
    const recovered: MediaTaskRecord = {
      ...record,
      status: 'succeeded' as const,
      assets: [{ type: 'video' as const, filePath: '/tmp/recovered.mp4' }],
    }
    let current = record
    const runtime = {
      inquire: vi.fn(() => current),
      inquireByRequestId: vi.fn(),
      beginRecovery: vi.fn(() => {
        current = { ...record, status: 'running' }
        return { record: current, started: true }
      }),
      markRecovered: vi.fn(() => {
        current = recovered
        return recovered
      }),
      markRecoveryFailed: vi.fn(),
    }
    registerCanvasMediaRepollIpc({
      getProfile: vi.fn(
        async () =>
          ({
            id: 'provider-1',
            name: 'Ark',
            mediaProvider: 'volcengine-ark',
            defaultModel: 'seedance',
          }) as any,
      ),
      getApiKey: vi.fn(async () => 'secret'),
      getRuntime: () => runtime as any,
    })

    const response = await handler()({
      projectId: 'project-1',
      clientTaskId: 'canvas-task-1',
      runtimeTaskId: 'runtime-1',
      providerProfileId: 'provider-1',
      providerTaskId: 'provider-task-1',
    })

    expect(response).toMatchObject({
      repoll: true,
      status: 'running',
      providerTaskId: 'provider-task-1',
    })
    await vi.waitFor(() => expect(harness.events).toHaveLength(1))
    expect(runtime.beginRecovery).toHaveBeenCalledWith('runtime-1', 'provider-task-1')
    expect(harness.recover).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'provider-task-1' }),
    )
    expect(runtime.markRecovered).toHaveBeenCalledWith(
      'runtime-1',
      expect.objectContaining({ provider: 'volcengine-ark' }),
    )
    expect(harness.events[0]?.payload.projectId).toBe('project-1')
    expect(harness.events[0]?.payload.response).toMatchObject({
      status: 'succeeded',
      requestId: 'provider-task-1',
    })
  })

  it('does not allow a renderer to inject another canvas task stream', async () => {
    const runtime = { inquire: vi.fn(() => failedRecord()), inquireByRequestId: vi.fn() }
    registerCanvasMediaRepollIpc({
      getProfile: vi.fn(),
      getApiKey: vi.fn(),
      getRuntime: () => runtime as any,
    })
    const response = await handler()({
      projectId: 'other-project',
      clientTaskId: 'other-task',
      runtimeTaskId: 'runtime-1',
      providerProfileId: 'provider-1',
      providerTaskId: 'provider-task-1',
    })
    expect(response.error?.code).toBe('poll_resume_unavailable')
    expect(harness.recover).not.toHaveBeenCalled()
    expect(harness.events).toHaveLength(0)
  })

  it('does not start a second loop after another caller claims recovery', async () => {
    const record = failedRecord()
    const runtime = {
      inquire: vi.fn(() => record),
      beginRecovery: vi.fn(() => ({ record: { ...record, status: 'running' }, started: false })),
    }
    registerCanvasMediaRepollIpc({
      getProfile: vi.fn(
        async () =>
          ({
            id: 'provider-1',
            name: 'Ark',
            mediaProvider: 'volcengine-ark',
            defaultModel: 'seedance',
          }) as any,
      ),
      getApiKey: vi.fn(async () => 'secret'),
      getRuntime: () => runtime as any,
    })
    const response = await handler()({
      projectId: 'project-1',
      clientTaskId: 'canvas-task-1',
      runtimeTaskId: 'runtime-1',
      providerProfileId: 'provider-1',
      providerTaskId: 'provider-task-1',
    })
    expect(response).toMatchObject({
      repoll: true,
      status: 'running',
      message: '该任务已经在轮询中',
    })
    expect(runtime.beginRecovery).toHaveBeenCalledWith('runtime-1', 'provider-task-1')
    expect(harness.recover).not.toHaveBeenCalled()
  })

  function handler() {
    const registered = harness.handlers.get('canvas:task:repoll-media')
    if (!registered) throw new Error('repoll handler was not registered')
    return registered
  }
})

function failedRecord(): MediaTaskRecord {
  return {
    id: 'runtime-1',
    providerProfileId: 'provider-1',
    providerKind: 'volcengine-ark',
    manifestId: 'manifest-1',
    modelId: 'seedance',
    operation: 'text_to_video',
    capability: 'video.generate',
    status: 'failed',
    mode: 'async',
    prompt: 'hello',
    negativePrompt: null,
    inputFiles: [],
    modelParams: {},
    outputDir: '/tmp/media',
    requestId: 'provider-task-1',
    providerTaskId: 'provider-task-1',
    projectId: 'project-1',
    clientTaskId: 'canvas-task-1',
    polling: {
      version: 1,
      providerKind: 'volcengine-ark',
      strategy: 'volcengine-ark',
      capability: 'video.generate',
      modelId: 'seedance',
      manifestId: 'manifest-1',
      outputType: 'video',
      manifest: null,
      manifestCapability: null,
      intervalMs: 1,
      timeoutMs: 10,
      maxAttempts: 1,
    },
    assets: [],
    submitResponse: { id: 'provider-task-1' },
    rawResponse: null,
    requestCall: null,
    error: { code: 'task_timeout', message: 'poll timeout' },
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:01:00.000Z',
    submittedAt: '2026-08-08T00:00:01.000Z',
    completedAt: '2026-08-08T00:01:00.000Z',
  }
}
