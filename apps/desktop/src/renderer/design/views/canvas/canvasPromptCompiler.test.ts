import { describe, expect, it } from 'vitest'
import type { CanvasPromptDocument } from '@spark/protocol'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { CanvasPromptCompileError, compileCanvasPromptDocument } from './canvasPromptCompiler'

function node(id: string, type: CanvasNode['type'], title: string, data: CanvasNode['data'] = {}): CanvasNode {
  return {
    id,
    projectId: 'p1',
    boardId: 'b1',
    userId: 1,
    type,
    title,
    assetId: data.url ? `asset-${id}` : null,
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
    data,
    createdAt: '',
    updatedAt: '',
  }
}

function imageNode(id: string, url: string, title: string): CanvasNode {
  return node(id, 'image', title, { url, thumbnailUrl: `${url}?thumb`, mimeType: 'image/png' })
}

const imageAsset = (id: string, url: string, title: string): CanvasAsset => ({
  id,
  projectId: 'p1',
  userId: 1,
  type: 'image',
  source: 'upload',
  title,
  mimeType: 'image/png',
  storageKey: `assets/${id}.png`,
  url,
  thumbnailUrl: `${url}?thumb`,
  metadata: {},
  createdAt: '',
  updatedAt: '',
})

describe('canvasPromptCompiler', () => {
  it('keeps document order and maps image relations to stable media roles', () => {
    const hero = imageNode('hero', 'safe-file://hero.png', '小满')
    const first = imageNode('first', 'safe-file://first.png', '首帧')
    const last = imageNode('last', 'safe-file://last.png', '尾帧')
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'text', id: 't1', text: '让' },
        { kind: 'reference', id: 'r1', source: 'manual', sourceNodeId: 'hero', relation: 'character', label: '小满', order: 0 },
        { kind: 'text', id: 't2', text: '从首帧到尾帧保持一致' },
        { kind: 'reference', id: 'r2', source: 'connection', sourceNodeId: 'first', relation: 'first_frame', label: '首帧', order: 1 },
        { kind: 'reference', id: 'r3', source: 'connection', sourceNodeId: 'last', relation: 'last_frame', label: '尾帧', order: 2 },
      ],
    }
    const result = compileCanvasPromptDocument({
      document,
      nodes: [hero, first, last],
      assets: [imageAsset('asset-hero', 'safe-file://hero.png', '小满'), imageAsset('asset-first', 'safe-file://first.png', '首帧'), imageAsset('asset-last', 'safe-file://last.png', '尾帧')],
      operation: 'image_to_video',
      systemPrompt: 'hidden capability',
    })

    expect(result.compiledUserText).toContain('参考图 #1：小满（角色）')
    expect(result.compiledUserText).toContain('[首帧图：首帧（首帧）]')
    expect(result.compiledUserText).toContain('[尾帧图：尾帧（尾帧）]')
    expect(result.compiledUserText).not.toContain('hidden capability')
    expect(result.inputFiles?.map((file) => file.role)).toEqual(['reference', 'first_frame', 'last_frame'])
    expect(result.relationManifest.map((item) => item.relation)).toEqual(['character', 'first_frame', 'last_frame'])
    expect(result.inputSnapshots[0]).toMatchObject({ previewUrl: 'safe-file://hero.png?thumb', kind: 'image' })
  })

  it('renders structured storyboard content and keeps structured snapshot data', () => {
    const shots = node('shots', 'text', '镜头表', { pipelineRole: 'shot', text: JSON.stringify({ shots: [{ index: 1, title: '车站', description: '小满走入雨幕' }] }) })
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [{ kind: 'structured', id: 's1', sourceNodeId: 'shots', schema: 'storyboard', summary: '镜头 1' }],
    }
    const result = compileCanvasPromptDocument({ document, nodes: [shots], assets: [], operation: 'text_generate' })

    expect(result.compiledUserText).toContain('[文本引用 T1 开始]')
    expect(result.compiledUserText).toContain('类型：分镜脚本')
    expect(result.compiledUserText).toContain('名称：镜头 1')
    expect(result.compiledUserText).toContain('[/文本引用 T1 结束]')
    expect(result.inputSnapshots[0]?.structuredData).toEqual({ shots: [{ index: 1, title: '车站', description: '小满走入雨幕' }] })
    expect(result.relationManifest[0]).toMatchObject({ relation: 'storyboard', sourceNodeId: 'shots' })
  })

  it('blocks missing references instead of silently dropping them', () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [{ kind: 'reference', id: 'missing', source: 'manual', sourceNodeId: 'gone', relation: 'scene', label: '已删除场景', order: 0 }],
    }
    expect(() => compileCanvasPromptDocument({ document, nodes: [], assets: [], operation: 'text_to_image' })).toThrow(CanvasPromptCompileError)
  })

  it('blocks submission of disconnected references', () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [{
        kind: 'reference', id: 'r1', source: 'connection', sourceNodeId: 'hero', relation: 'character',
        connectionRelation: 'reference_image', disconnected: true, label: '小满', order: 0,
      }],
    }
    const hero = imageNode('hero', 'safe-file://hero.png', '小满')
    expect(() => compileCanvasPromptDocument({ document, nodes: [hero], assets: [], operation: 'text_to_image' }))
      .toThrow(CanvasPromptCompileError)
  })

  it('ignores a connected input that the user suppressed in the prompt editor', () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [{
        kind: 'reference', id: 'r1', source: 'connection', sourceNodeId: 'hero', relation: 'character',
        connectionRelation: 'character', suppressed: true, label: '小满', order: 0,
      }],
    }
    const result = compileCanvasPromptDocument({
      document,
      nodes: [imageNode('hero', 'safe-file://hero.png', '小满')],
      assets: [],
      operation: 'text_to_image',
    })
    expect(result.compiledUserText).toBe('')
    expect(result.inputFiles).toEqual([])
    expect(result.relationManifest).toEqual([])
  })

  it('injects structured parameter chips into the executable user prompt', () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'text', id: 't1', text: '生成镜头' },
        { kind: 'parameter', id: 'p1', parameter: 'duration', value: 8, unit: '秒' },
        { kind: 'parameter', id: 'p2', parameter: 'dialogue', value: '别回头', relation: '角色台词' },
      ],
    }
    const result = compileCanvasPromptDocument({
      document, nodes: [], assets: [], operation: 'text_to_video',
    })

    expect(result.compiledUserText).toContain('[参数/duration] 8 秒')
    expect(result.compiledUserText).toContain('[参数/dialogue] 别回头；关系：角色台词')
  })

  it('uses the original media url as the task-detail preview when no thumbnail exists', () => {
    const hero = imageNode('hero', 'safe-file://hero.png', '小满')
    delete hero.data.thumbnailUrl
    const asset = imageAsset('asset-hero', 'safe-file://hero.png', '小满')
    delete asset.thumbnailUrl
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [{ kind: 'reference', id: 'r1', source: 'manual', sourceNodeId: 'hero', relation: 'reference_image', label: '参考图', order: 0 }],
    }
    const result = compileCanvasPromptDocument({ document, nodes: [hero], assets: [asset], operation: 'text_to_image' })
    expect(result.inputSnapshots[0]?.previewUrl).toBe('safe-file://hero.png')
  })

  it('numbers text and reference images independently in final provider order', () => {
    const first = imageNode('first', 'safe-file://first.png', '角色板')
    const second = imageNode('second', 'safe-file://second.png', '场景板')
    const note = node('note', 'text', 'Text note', { text: '保持雨夜氛围' })
    const direction = node('direction', 'text', '补充说明', { text: '镜头运动保持克制' })
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'reference', id: 'text-1', source: 'manual', sourceNodeId: 'note', relation: 'generic', label: 'Text note', order: 0 },
        { kind: 'reference', id: 'image-1', source: 'manual', sourceNodeId: 'first', relation: 'character', label: '角色板', order: 1 },
        { kind: 'structured', id: 'text-2', sourceNodeId: 'direction', schema: 'table', summary: '补充说明' },
        { kind: 'reference', id: 'image-2', source: 'manual', sourceNodeId: 'second', relation: 'scene', label: '场景板', order: 2 },
      ],
    }

    const result = compileCanvasPromptDocument({
      document,
      nodes: [note, direction, first, second],
      assets: [],
      operation: 'text_to_video',
    })

    expect(result.compiledUserText).toContain('参考图 #1：角色板（角色）')
    expect(result.compiledUserText).toContain('参考图 #2：场景板（场景）')
    expect(result.compiledUserText).toContain('[文本引用 T1 开始]')
    expect(result.compiledUserText).toContain('[文本引用 T2 开始]')
    expect(result.compiledUserText).not.toContain('ref-')
    expect(result.inputFiles?.map((file) => file.url)).toEqual([
      'safe-file://first.png',
      'safe-file://second.png',
    ])
    expect(result.relationManifest.find((item) => item.blockId === 'image-1')?.modelReference)
      .toEqual({ channel: 'reference_images', ordinal: 1, label: '参考图 #1' })
    expect(result.relationManifest.find((item) => item.blockId === 'text-1')?.modelReference)
      .toEqual({ channel: 'text', ordinal: 1, label: '文本引用 T1' })
  })

  it('keeps field-to-resource mappings inline and moves full resources below user input', () => {
    const storyboard = node('storyboard', 'text', '生成分镜脚本', { text: '分镜 1\n场景：出租屋' })
    const hero = imageNode('hero', 'safe-file://hero.png', '5555')
    const scene = imageNode('scene', 'safe-file://scene.png', '12_出租屋360场景板.png')
    const style = node('style', 'text', '全局风格指引', { text: '写实都市 / 末日硬核' })
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'text', id: 'label-storyboard', text: '片段详情设计：' },
        { kind: 'reference', id: 'storyboard-ref', source: 'manual', sourceNodeId: 'storyboard', relation: 'storyboard', label: '生成分镜脚本', order: 0 },
        { kind: 'text', id: 'label-character', text: '\n\n角色苏烬：' },
        { kind: 'reference', id: 'hero-ref', source: 'manual', sourceNodeId: 'hero', relation: 'character', label: '5555', order: 1 },
        { kind: 'text', id: 'label-scene', text: '\n\n场景：' },
        { kind: 'reference', id: 'scene-ref', source: 'manual', sourceNodeId: 'scene', relation: 'scene', label: '12_出租屋360场景板.png', order: 2 },
        { kind: 'text', id: 'label-style', text: '\n\n风格：' },
        { kind: 'reference', id: 'style-ref', source: 'manual', sourceNodeId: 'style', relation: 'generic', label: '全局风格指引', order: 3 },
      ],
    }

    const result = compileCanvasPromptDocument({
      document,
      nodes: [storyboard, hero, scene, style],
      assets: [],
      operation: 'text_to_video',
    })

    expect(result.compiledUserText).toContain(
      [
        '[用户输入与引用关系]',
        '片段详情设计：文本引用 T1',
        '',
        '角色苏烬：参考图 #1',
        '',
        '场景：参考图 #2',
        '',
        '风格：文本引用 T2',
        '[/用户输入与引用关系]',
      ].join('\n'),
    )
    expect(result.compiledUserText).toContain(
      '[引用资源]\n[图片引用]\n参考图 #1：5555（角色）\n参考图 #2：12_出租屋360场景板.png（场景）\n[/图片引用]',
    )
    expect(result.compiledUserText.indexOf('[引用资源]'))
      .toBeGreaterThan(result.compiledUserText.indexOf('[/用户输入与引用关系]'))
    expect(result.compiledUserText.match(/\[文本引用 T1 开始\]/g)).toHaveLength(1)
    expect(result.compiledUserText.match(/\[文本引用 T2 开始\]/g)).toHaveLength(1)
  })

  it('reuses one provider image slot for duplicate mentions of the same source and role', () => {
    const hero = imageNode('hero', 'safe-file://hero.png', '苏烬')
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'reference', id: 'image-a', source: 'manual', sourceNodeId: 'hero', relation: 'character', label: '苏烬', order: 0 },
        { kind: 'reference', id: 'image-b', source: 'manual', sourceNodeId: 'hero', relation: 'character', label: '苏烬近景', order: 1 },
      ],
    }

    const result = compileCanvasPromptDocument({
      document,
      nodes: [hero],
      assets: [],
      operation: 'text_to_video',
    })

    expect(result.inputFiles).toHaveLength(1)
    expect(result.compiledUserText.match(/参考图 #1/g)).toHaveLength(3)
    expect(result.relationManifest.map((item) => item.modelReference?.ordinal)).toEqual([1, 1])
  })

  it('renders one bounded text body and reuses its T reference for duplicate mentions', () => {
    const note = node('note', 'text', 'Text note', { text: '保持雨夜氛围' })
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'reference', id: 'text-a', source: 'manual', sourceNodeId: 'note', relation: 'generic', label: '氛围说明', order: 0 },
        { kind: 'text', id: 'instruction', text: '下一段继续沿用以上资料' },
        { kind: 'reference', id: 'text-b', source: 'manual', sourceNodeId: 'note', relation: 'generic', label: '氛围说明（再次引用）', order: 1 },
      ],
    }

    const result = compileCanvasPromptDocument({
      document,
      nodes: [note],
      assets: [],
      operation: 'text_generate',
    })

    expect(result.compiledUserText.match(/\[文本引用 T1 开始\]/g)).toHaveLength(1)
    expect(result.compiledUserText.match(/保持雨夜氛围/g)).toHaveLength(1)
    expect(result.compiledUserText).toContain(
      '[用户输入与引用关系]\n文本引用 T1下一段继续沿用以上资料文本引用 T1\n[/用户输入与引用关系]',
    )
    expect(result.compiledUserText).not.toContain('文本引用 T2')
    expect(result.relationManifest.map((item) => item.modelReference)).toEqual([
      { channel: 'text', ordinal: 1, label: '文本引用 T1' },
      { channel: 'text', ordinal: 1, label: '文本引用 T1' },
    ])
  })

  it('is deterministic for identical input and warns for empty documents', () => {
    const document: CanvasPromptDocument = { version: 2, blocks: [] }
    const a = compileCanvasPromptDocument({ document, nodes: [], assets: [], operation: 'text_generate' })
    const b = compileCanvasPromptDocument({ document, nodes: [], assets: [], operation: 'text_generate' })
    expect(a).toEqual(b)
    expect(a.promptWarnings).toEqual([{ code: 'empty_prompt', message: '提示词和媒体输入均为空' }])
  })
})
