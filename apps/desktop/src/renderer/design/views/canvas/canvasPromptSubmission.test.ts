import { describe, expect, it, vi } from 'vitest'
import type { CanvasPromptDocument } from '@spark/protocol'
import type { CanvasAsset, CanvasNode, CanvasSnapshot } from './canvas.types'
import {
  buildCanvasPromptDocumentForInputs,
  buildCanvasPromptSubmission,
} from './canvasPromptSubmission'
import { encodeToSafeFileUrl } from './canvas-safe-file'

function imageNode(): CanvasNode {
  return {
    id: 'hero',
    projectId: 'p',
    boardId: 'b',
    userId: 1,
    type: 'image',
    title: '小满',
    assetId: 'hero-asset',
    taskId: null,
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 0,
    locked: false,
    hidden: false,
    data: { url: 'data:image/png;base64,AA==', mimeType: 'image/png' },
    createdAt: '',
    updatedAt: '',
  }
}

function textNode(): CanvasNode {
  return {
    id: 'script',
    projectId: 'p',
    boardId: 'b',
    userId: 1,
    type: 'text',
    title: '场次剧本',
    assetId: null,
    taskId: null,
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 0,
    locked: false,
    hidden: false,
    data: { text: '雨夜里，小满走进车站。', pipelineRole: 'screenplay' },
    createdAt: '',
    updatedAt: '',
  }
}

const asset: CanvasAsset = {
  id: 'hero-asset',
  projectId: 'p',
  userId: 1,
  type: 'image',
  source: 'upload',
  title: '小满',
  mimeType: 'image/png',
  metadata: {},
  createdAt: '',
  updatedAt: '',
}

const snapshot = (): CanvasSnapshot => ({
  project: {} as CanvasSnapshot['project'],
  board: {} as CanvasSnapshot['board'],
  nodes: [imageNode()],
  edges: [],
  assets: [asset],
  tasks: [],
})

describe('canvasPromptSubmission', () => {
  it.each([
    ['resolved output', 'operation-output:asset-text'],
    ['legacy task owner', 'operation-text'],
  ])('compiles a connected text task output bound by its %s', async (_case, bindingNodeId) => {
    const taskOutput = taskOutputSnapshot('text')
    const result = await buildCanvasPromptSubmission({
      document: {
        version: 2,
        blocks: [
          {
            kind: 'reference',
            id: 'connection-text',
            source: 'connection',
            sourceNodeId: 'operation-text',
            relation: 'generic',
            label: '上游文本任务',
            order: 0,
          },
        ],
      },
      snapshot: taskOutput,
      operation: 'text_to_image',
      inputBindings: [
        {
          id: `connection:${bindingNodeId}:input`,
          sourceNodeId: bindingNodeId,
          origin: 'connection',
          kind: 'text',
          relation: 'generic',
          role: 'input',
          enabled: true,
          order: 0,
          promptBlockId: 'connection-text',
        },
      ],
    })

    expect(result.prompt).toContain('[文本引用 T1 开始]')
    expect(result.prompt).toContain('雨夜车站里的重逢镜头')
    expect(result.relationManifest).toEqual([
      expect.objectContaining({ sourceNodeId: 'operation-output:asset-text' }),
    ])
  })

  it.each(['image', 'video', 'audio'] as const)(
    'compiles a lazily materialized %s task output selected as a reference',
    async (kind) => {
      const taskOutput = taskOutputSnapshot(kind)
      const outputNodeId = `operation-output:asset-${kind}`
      const relation =
        kind === 'image'
          ? 'reference_image'
          : kind === 'video'
            ? 'reference_video'
            : 'reference_audio'
      const result = await buildCanvasPromptSubmission({
        document: {
          version: 2,
          blocks: [
            { kind: 'text', id: 'text', text: '保持参考一致' },
            {
              kind: 'reference',
              id: `connection-${kind}`,
              source: 'connection',
              sourceNodeId: `operation-${kind}`,
              relation,
              label: `${kind} task output`,
              order: 0,
            },
          ],
        },
        snapshot: taskOutput,
        operation: 'text_to_video',
        inputBindings: [
          {
            id: `picker:${outputNodeId}:reference`,
            sourceNodeId: outputNodeId,
            origin: 'picker',
            kind,
            relation,
            role: 'reference',
            enabled: true,
            order: 0,
            promptBlockId: `connection-${kind}`,
          },
        ],
        inputRoles: { [outputNodeId]: 'reference' },
      })

      expect(result.inputFiles).toEqual([
        expect.objectContaining({ type: kind, role: 'reference' }),
      ])
      expect(result.relationManifest).toEqual([
        expect.objectContaining({ sourceNodeId: outputNodeId }),
      ])
    },
  )

  it('propagates a legacy task-owner first-frame role to its resolved image output', async () => {
    const taskOutput = taskOutputSnapshot('image')
    const result = await buildCanvasPromptSubmission({
      document: { version: 2, blocks: [{ kind: 'text', id: 'text', text: '生成视频' }] },
      snapshot: taskOutput,
      operation: 'image_to_video',
      inputBindings: [
        {
          id: 'picker:operation-image:first_frame',
          sourceNodeId: 'operation-image',
          origin: 'picker',
          kind: 'image',
          relation: 'first_frame',
          role: 'first_frame',
          enabled: true,
          order: 0,
        },
      ],
      inputRoles: { 'operation-image': 'first_frame' },
    })

    expect(result.inputFiles).toEqual([
      expect.objectContaining({ type: 'image', role: 'first_frame' }),
    ])
    expect(result.relationManifest).toEqual([
      expect.objectContaining({
        sourceNodeId: 'operation-output:asset-image',
        relation: 'first_frame',
      }),
    ])
  })

  it('does not upload local media when a caller requests cloud_url transport', async () => {
    const invoke = vi.fn()
    vi.stubGlobal('window', { spark: { invoke } })
    const videoNode = {
      ...imageNode(),
      id: 'local-video',
      type: 'video' as const,
      title: '本地视频',
      assetId: null,
      data: { url: encodeToSafeFileUrl('/Users/test/input.mp4'), mimeType: 'video/mp4' },
    }
    const document = buildCanvasPromptDocumentForInputs({
      prompt: '',
      nodes: [videoNode],
      assets: [],
    })

    try {
      const result = await buildCanvasPromptSubmission({
        document,
        snapshot: { ...snapshot(), nodes: [videoNode], assets: [] },
        operation: 'video_depth_map',
        inputNodeIds: ['local-video'],
        inputTransport: 'cloud_url',
      })

      expect(result.inputFiles).toEqual([
        expect.objectContaining({
          type: 'video',
          url: encodeToSafeFileUrl('/Users/test/input.mp4'),
          mimeType: 'video/mp4',
        }),
      ])
      expect(invoke).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('preserves video reference semantics when applying generic reference roles', async () => {
    const videoNode = {
      ...imageNode(),
      id: 'video-ref',
      type: 'video' as const,
      title: '动作参考',
      assetId: 'video-asset',
      data: { url: 'https://cdn.example.com/reference.mp4', mimeType: 'video/mp4' },
    }
    const videoAsset = {
      ...asset,
      id: 'video-asset',
      type: 'video' as const,
      title: '动作参考',
      mimeType: 'video/mp4',
      url: 'https://cdn.example.com/reference.mp4',
    }
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'text', id: 'text', text: '参考动作生成' },
        {
          kind: 'reference',
          id: 'ref',
          source: 'manual',
          sourceNodeId: 'video-ref',
          relation: 'reference_video',
          label: '动作参考',
          order: 0,
        },
      ],
    }
    const result = await buildCanvasPromptSubmission({
      document,
      snapshot: {
        ...snapshot(),
        nodes: [videoNode],
        assets: [videoAsset],
      },
      operation: 'text_to_video',
      inputNodeIds: ['video-ref'],
      inputRoles: { 'video-ref': 'reference' },
    })

    expect(result.relationManifest).toEqual([
      expect.objectContaining({ sourceNodeId: 'video-ref', relation: 'reference_video' }),
    ])
    expect(result.inputFiles).toEqual([
      expect.objectContaining({ type: 'video', role: 'reference' }),
    ])
  })

  it('keeps media inputs visible as tags in the editor document', () => {
    const document = buildCanvasPromptDocumentForInputs({
      prompt: '保持人物一致',
      nodes: [imageNode()],
      assets: [asset],
    })
    expect(document.blocks).toEqual([
      { kind: 'text', id: expect.any(String), text: '保持人物一致' },
      expect.objectContaining({
        kind: 'reference',
        source: 'connection',
        sourceNodeId: 'hero',
        relation: 'reference_image',
      }),
      { kind: 'text', id: expect.any(String), text: '' },
    ])
  })

  it('compiles a visible media tag into the executable request', async () => {
    const document = buildCanvasPromptDocumentForInputs({
      prompt: '保持人物一致',
      nodes: [imageNode()],
      assets: [asset],
    })
    const result = await buildCanvasPromptSubmission({
      document,
      snapshot: snapshot(),
      operation: 'text_to_image',
      inputNodeIds: ['hero'],
      inputTransport: 'base64',
    })

    expect(result.promptDocument).toEqual(document)
    expect(result.prompt).toContain(
      '[用户输入与引用关系]\n保持人物一致参考图 #1\n[/用户输入与引用关系]',
    )
    expect(result.prompt).toContain('参考图 #1：小满（参考图）')
    expect(result.inputFiles).toEqual([
      {
        type: 'image',
        role: 'reference',
        dataUrl: 'data:image/png;base64,AA==',
        mimeType: 'image/png',
      },
    ])
    expect(result.relationManifest).toEqual([
      expect.objectContaining({ sourceNodeId: 'hero', relation: 'reference_image' }),
    ])
  })

  it('compiles an upstream text tag into the model user prompt and relation manifest', async () => {
    const script = textNode()
    const document = buildCanvasPromptDocumentForInputs({
      prompt: '提取主要场景：',
      nodes: [script],
      assets: [],
    })
    const textSnapshot: CanvasSnapshot = {
      ...snapshot(),
      nodes: [script],
      assets: [],
    }
    const result = await buildCanvasPromptSubmission({
      document,
      snapshot: textSnapshot,
      operation: 'text_generate',
      inputNodeIds: ['script'],
    })

    expect(result.promptDocument?.blocks).toEqual([
      expect.objectContaining({ kind: 'text', text: '提取主要场景：' }),
      expect.objectContaining({
        kind: 'reference',
        sourceNodeId: 'script',
        relation: 'screenplay',
      }),
      expect.objectContaining({ kind: 'text', text: '' }),
    ])
    expect(result.prompt).toContain(
      '[用户输入与引用关系]\n提取主要场景：文本引用 T1\n[/用户输入与引用关系]',
    )
    expect(result.prompt).toContain('[文本引用 T1 开始]')
    expect(result.prompt).toContain('类型：剧本')
    expect(result.prompt).toContain('名称：场次剧本')
    expect(result.prompt).toContain('[/文本引用 T1 结束]')
    expect(result.prompt).toContain('雨夜里，小满走进车站。')
    expect(result.relationManifest).toEqual([
      expect.objectContaining({ sourceNodeId: 'script', relation: 'screenplay' }),
    ])
  })

  it('returns a compiled prompt, document, relation manifest and materialized image input', async () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'text', id: 't1', text: '让' },
        {
          kind: 'reference',
          id: 'r1',
          source: 'manual',
          sourceNodeId: 'hero',
          relation: 'character',
          label: '小满',
          order: 0,
        },
      ],
    }
    const result = await buildCanvasPromptSubmission({
      document,
      snapshot: snapshot(),
      operation: 'text_to_image',
      inputTransport: 'base64',
      systemPrompt: 'hidden',
    })

    expect(result.prompt).toContain('参考图 #1：小满（角色）')
    expect(result.compiledUserText).toBe(result.prompt)
    expect(result.promptDocument).toEqual(document)
    expect(result.promptSnapshot?.capturedAt).toEqual(expect.any(String))
    expect(result.systemPrompt).toBe('hidden')
    expect(result.inputFiles).toEqual([
      {
        type: 'image',
        role: 'reference',
        dataUrl: 'data:image/png;base64,AA==',
        mimeType: 'image/png',
      },
    ])
    expect(result.relationManifest?.[0]).toMatchObject({
      relation: 'character',
      sourceNodeId: 'hero',
    })
  })

  it('uses active input bindings as the canonical executable input set', async () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'text', id: 'text', text: '保持主体一致' },
        {
          kind: 'reference',
          id: 'image',
          source: 'manual',
          sourceNodeId: 'hero',
          relation: 'reference_image',
          label: '小满',
          order: 0,
        },
      ],
    }
    const result = await buildCanvasPromptSubmission({
      document,
      snapshot: snapshot(),
      operation: 'text_to_image',
      inputNodeIds: ['hero'],
      inputBindings: [
        {
          id: 'manual:hero:reference',
          sourceNodeId: 'hero',
          origin: 'manual',
          kind: 'image',
          relation: 'reference_image',
          role: 'reference',
          enabled: false,
          order: 0,
          promptBlockId: 'image',
        },
      ],
    })

    expect(result.inputBindings).toEqual([expect.objectContaining({ enabled: false })])
    expect(result.inputFiles).toBeUndefined()
    expect(result.compiledUserText).toBe('保持主体一致')
    expect(result.relationManifest).toEqual([])
  })
})

function taskOutputSnapshot(kind: 'image' | 'video' | 'audio' | 'text'): CanvasSnapshot {
  const operationByKind = {
    image: 'text_to_image',
    video: 'text_to_video',
    audio: 'extract_audio',
    text: 'text_generate',
  } as const
  const extensionByKind = { image: 'png', video: 'mp4', audio: 'mp3', text: 'txt' } as const
  const mimeTypeByKind = {
    image: 'image/png',
    video: 'video/mp4',
    audio: 'audio/mpeg',
    text: 'text/plain',
  } as const
  const operation = operationByKind[kind]
  const operationNode: CanvasNode = {
    ...imageNode(),
    id: `operation-${kind}`,
    type: operation,
    assetId: null,
    taskId: `task-${kind}`,
    data: { operation, status: 'completed' },
  }
  const outputAsset: CanvasAsset = {
    ...asset,
    id: `asset-${kind}`,
    type: kind,
    title: `${kind} output`,
    mimeType: mimeTypeByKind[kind],
    ...(kind === 'text'
      ? { contentText: '雨夜车站里的重逢镜头' }
      : { url: `https://cdn.example.com/output.${extensionByKind[kind]}` }),
  }
  return {
    ...snapshot(),
    nodes: [operationNode],
    assets: [outputAsset],
    tasks: [
      {
        id: `task-${kind}`,
        projectId: 'p',
        boardId: 'b',
        userId: 1,
        operation,
        status: 'completed',
        progress: 100,
        inputNodeIds: [],
        inputAssetIds: [],
        outputNodeIds: [],
        outputAssetIds: [outputAsset.id],
        modelParams: {},
        createdAt: '2026-08-23T00:00:00.000Z',
        updatedAt: '2026-08-23T00:00:00.000Z',
      },
    ],
  }
}
