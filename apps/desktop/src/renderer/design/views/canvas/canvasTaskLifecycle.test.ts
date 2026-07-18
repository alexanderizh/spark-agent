import { describe, expect, it } from 'vitest'
import {
  appendCanvasTaskRuntimeEvent,
  appendCanvasTaskModelOutputEvent,
  initialCanvasTaskRuntimeEvents,
  syncCanvasNodeRuntimeData,
  syncCanvasTaskRuntimeToNode,
} from './canvasTaskLifecycle'
import type { CanvasNodeData, CanvasTask } from './canvas.types'

describe('canvas task lifecycle diagnostics', () => {
  it('replaces stale node runtime fields when a new task is bound', () => {
    const data: CanvasNodeData = {
      modelId: 'old-model',
      providerProfileId: 'old-provider',
      agentId: 'old-agent',
      modelParams: { temperature: 1 },
      pipelineRole: 'character',
    }

    syncCanvasNodeRuntimeData(data, {
      modelId: 'new-model',
      providerProfileId: 'new-provider',
      agentId: 'new-agent',
      modelParams: { temperature: 0.2 },
      taskPipelineRole: 'shot',
      outputPipelineRole: 'shot',
      skillIds: ['storyboard'],
    })

    expect(data).toMatchObject({
      modelId: 'new-model',
      providerProfileId: 'new-provider',
      agentId: 'new-agent',
      modelParams: { temperature: 0.2 },
      pipelineRole: 'shot',
      outputPipelineRole: 'shot',
      skillIds: ['storyboard'],
    })
  })

  it('clears runtime fields instead of retaining values from an older task', () => {
    const data: CanvasNodeData = {
      modelId: 'old-model',
      providerProfileId: 'old-provider',
      agentId: 'old-agent',
      pipelineRole: 'shot',
      outputPipelineRole: 'shot',
    }

    syncCanvasNodeRuntimeData(data, {})

    expect(data.modelId).toBeUndefined()
    expect(data.providerProfileId).toBeUndefined()
    expect(data.agentId).toBeUndefined()
    expect(data.pipelineRole).toBeUndefined()
    expect(data.outputPipelineRole).toBeUndefined()
  })

  it('records lifecycle events in append order', () => {
    const task = { runtimeEvents: initialCanvasTaskRuntimeEvents('2026-07-18T00:00:00.000Z') }
    appendCanvasTaskRuntimeEvent(task, {
      at: '2026-07-18T00:00:01.000Z',
      kind: 'failed',
      label: '结构解析失败',
    })
    expect(task.runtimeEvents.map((event) => event.kind)).toEqual(['created', 'failed'])
  })

  it('records the actual model output size as a provider response event', () => {
    const task = { runtimeEvents: initialCanvasTaskRuntimeEvents('2026-07-18T00:00:00.000Z') }
    appendCanvasTaskModelOutputEvent(task, '2026-07-18T00:00:01.000Z', '模型输出')
    expect(task.runtimeEvents[1]).toMatchObject({
      kind: 'provider_response',
      detail: '4 字符',
    })
  })

  it('preserves semantic roles when an older task has no persisted role fields', () => {
    const data: CanvasNodeData = { pipelineRole: 'shot', outputPipelineRole: 'shot' }
    const task = {
      agentId: null,
      providerProfileId: null,
      manifestId: null,
      modelId: null,
      reasoningEffort: null,
      skillIds: [],
      modelParams: {},
    } as unknown as CanvasTask

    syncCanvasTaskRuntimeToNode(task, data)

    expect(data.pipelineRole).toBe('shot')
    expect(data.outputPipelineRole).toBe('shot')
  })
})
