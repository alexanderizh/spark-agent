import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildCanvasMediaProviderPrompt,
  buildCanvasRuntimeRequest,
  buildCanvasSystemPrompt,
  resolveCanvasAgentTurnResult,
  resolveCanvasRuntimeImages,
} from './canvas-prompt-runtime'

function toSafeFileUrl(absolutePath: string): string {
  const encoded = Buffer.from(absolutePath, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `safe-file://x/${encoded}`
}

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

  it('removes a connected text reference when its substantive body is already in system text', () => {
    const character =
      '二十出头的年轻女性，身高约160cm，体态娇小。肤色偏白，留着齐肩的黑色直发。'
    expect(
      buildCanvasMediaProviderPrompt({
        systemPrompt: `生成专业角色身份板。角色设定：${character}`,
        userPrompt: `[文本引用 T1 开始]\n类型：角色资料\n名称：小静\n\n${character}\n[/文本引用 T1 结束]`,
      }),
    ).toBe(`生成专业角色身份板。角色设定：${character}`)
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

  it('reads local input images into base64 dataUrls so the upstream vision API can consume them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-vision-'))
    try {
      const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex')
      const filePath = join(dir, 'input.png')
      await writeFile(filePath, pngBytes)

      const images = await resolveCanvasRuntimeImages({
        inputFiles: [
          { type: 'image', role: 'input', path: filePath, url: toSafeFileUrl(filePath) },
          { type: 'image', role: 'input', url: 'https://cdn.example.com/ref.png' },
          {
            type: 'image',
            role: 'input',
            dataUrl: 'data:image/webp;base64,UklGRg==',
            mimeType: 'image/webp',
          },
          { type: 'video', role: 'input', path: join(dir, 'clip.mp4') },
        ],
      })

      expect(images).toHaveLength(3)
      expect(images[0]).toEqual({
        mimeType: 'image/png',
        dataUrl: `data:image/png;base64,${pngBytes.toString('base64')}`,
      })
      expect(images[1]).toEqual({ url: 'https://cdn.example.com/ref.png' })
      expect(images[2]).toEqual({
        mimeType: 'image/webp',
        dataUrl: 'data:image/webp;base64,UklGRg==',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to decoding a safe-file url when path is absent, and infers mime from extension', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'canvas-vision-'))
    try {
      const filePath = join(dir, 'shot.jpeg')
      const bytes = Buffer.from('ffd8ffe000104a46', 'hex')
      await writeFile(filePath, bytes)

      const images = await resolveCanvasRuntimeImages({
        inputFiles: [{ type: 'image', role: 'input', url: toSafeFileUrl(filePath) }],
      })

      expect(images).toEqual([
        { mimeType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('skips unresolvable image inputs instead of silently sending nothing useful', async () => {
    const images = await resolveCanvasRuntimeImages({
      inputFiles: [{ type: 'image', role: 'input', url: 'safe-file://x/###invalid###' }],
    })
    expect(images).toEqual([])
  })

  it('throws with a readable message when a local input image cannot be read', async () => {
    const missing = join(tmpdir(), `canvas-vision-missing-${Date.now()}.png`)
    await expect(
      resolveCanvasRuntimeImages({ inputFiles: [{ type: 'image', path: missing }] }),
    ).rejects.toThrow('读取反推输入图片失败')
  })
})
