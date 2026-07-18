import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import {
  buildCanvasMediaProviderPrompt,
  buildCanvasRuntimeRequest,
  buildCanvasSystemPrompt,
  resolveCanvasAgentTurnResult,
} from './canvas-prompt-runtime'

describe('canvas prompt runtime adapter', () => {
  it('keeps compiled user text separate from capability and skill instructions', () => {
    const system = buildCanvasSystemPrompt({
      capabilityPrompt: '只输出可执行分镜',
      presetPrompt: '镜头时长必须统一',
      agentPrompt: '你是导演',
      skillPrompts: ['使用电影术语'],
      negativePrompt: '不要解释过程',
    })
    const request = buildCanvasRuntimeRequest({
      prompt: '[角色 ref-1: 小满]\n雨夜',
      compiledUserText: '[角色 ref-1: 小满]\n雨夜',
      systemPrompt: system,
      inputFiles: [{ type: 'image', role: 'reference', url: 'https://cdn/ref.png' }],
      relationManifest: [{ blockId: 'r1', sourceNodeId: 'n1', relation: 'character', order: 0 }],
    })

    expect(request.prompt).toBe('[角色 ref-1: 小满]\n雨夜')
    expect(request.prompt).not.toContain('只输出可执行分镜')
    expect(request.system).toContain('你是导演')
    expect(request.system.indexOf('你是导演')).toBeLessThan(
      request.system.indexOf('只输出可执行分镜'),
    )
    expect(request.images).toEqual([{ url: 'https://cdn/ref.png' }])
    expect(request.relationManifest).toEqual([
      { blockId: 'r1', sourceNodeId: 'n1', relation: 'character', order: 0 },
    ])
  })

  it('adds hidden system instructions to media provider text without changing the authored prompt', () => {
    expect(
      buildCanvasMediaProviderPrompt({ systemPrompt: '能力约束', userPrompt: '用户要求' }),
    ).toBe('能力约束\n\n用户要求')
    expect(buildCanvasMediaProviderPrompt({ systemPrompt: '', userPrompt: '用户要求' })).toBe('用户要求')
  })

  it('waits for the authoritative final assistant message instead of returning an intermediate complete item', () => {
    const base = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      timestamp: '2026-07-16T00:00:00.000Z',
      seq: 1,
    }
    const intermediate = [
      {
        ...base,
        id: 'message-1',
        type: 'assistant_message',
        mode: 'complete',
        content: '我先分析剧本。',
        isFinal: false,
      },
      { ...base, id: 'status-1', type: 'agent_status', status: 'working' },
    ] as AgentEvent[]

    expect(resolveCanvasAgentTurnResult(intermediate)).toEqual({ terminal: false })

    const completed = [
      ...intermediate,
      {
        ...base,
        id: 'message-2',
        type: 'assistant_message',
        mode: 'complete',
        content: '{"entities":[{"name":"林岚"}]}',
        isFinal: true,
      },
      { ...base, id: 'status-2', type: 'agent_status', status: 'completed' },
    ] as AgentEvent[]
    expect(resolveCanvasAgentTurnResult(completed)).toEqual({
      terminal: true,
      text: '{"entities":[{"name":"林岚"}]}',
    })
  })
})
