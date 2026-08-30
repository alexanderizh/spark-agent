import { describe, expect, it } from 'vitest'
import type {
  CanvasMediaTaskCreateRequest,
  CanvasMediaTaskCreateResponse,
  CanvasPromptBlock,
  CanvasPromptCompilation,
  CanvasPromptDocument,
  CanvasPromptResponseFields,
  CanvasPromptTaskFields,
} from './index.js'
import { CANVAS_PROMPT_VERSION, composeCanvasMediaProviderPrompt } from './canvas-prompt.js'

describe('canvas prompt protocol contract', () => {
  it('allows custom relation text on parameter blocks', () => {
    const block: CanvasPromptBlock = {
      kind: 'parameter',
      id: 'p1',
      parameter: 'custom',
      value: '站在主角左后方两米',
      relation: '相对主角的空间站位',
    }

    expect(block.relation).toBe('相对主角的空间站位')
  })

  it('uses the current versioned document contract', () => {
    expect(CANVAS_PROMPT_VERSION).toBe(2)
  })

  it('round-trips a mixed document without losing block order', () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'text', id: 't1', text: 'A quiet village at dawn' },
        {
          kind: 'reference',
          id: 'r1',
          source: 'manual',
          sourceNodeId: 'n1',
          relation: 'character',
          label: 'Mina',
          order: 0,
        },
        {
          kind: 'parameter',
          id: 'p1',
          parameter: 'duration',
          value: 8,
          unit: 'seconds',
        },
        {
          kind: 'structured',
          id: 's1',
          sourceNodeId: 'n2',
          schema: 'storyboard',
          summary: 'Shot 03-06',
        },
      ],
    }

    expect(JSON.parse(JSON.stringify(document))).toEqual(document)
    expect(document.blocks.map((block) => block.id)).toEqual(['t1', 'r1', 'p1', 's1'])
  })

  it('exposes the required fields for each block kind', () => {
    const blocks: CanvasPromptBlock[] = [
      { kind: 'text', id: 'text', text: 'text' },
      {
        kind: 'reference',
        id: 'reference',
        source: 'connection',
        sourceNodeId: 'node',
        relation: 'reference_image',
        label: 'Reference',
        order: 1,
      },
      { kind: 'parameter', id: 'parameter', parameter: 'custom', value: 'value' },
      {
        kind: 'structured',
        id: 'structured',
        sourceNodeId: 'node',
        schema: 'json',
        summary: '{}',
      },
    ]

    expect(blocks).toHaveLength(4)
  })

  it('keeps prompt fields optional so legacy requests remain assignable', () => {
    const legacyRequest: CanvasMediaTaskCreateRequest = {
      operation: 'text_to_image',
    }
    const promptFields: CanvasPromptTaskFields = {}

    expect(legacyRequest.promptDocument).toBeUndefined()
    expect(promptFields).toEqual({})
  })

  it('serializes non-sensitive compilation summaries on responses', () => {
    const responseFields: CanvasPromptResponseFields = {
      compiledUserText: 'A quiet village at dawn',
      systemPrompt: 'Follow the storyboard schema.',
      promptWarnings: [{ code: 'unsupported_relation', message: 'Relation was ignored.' }],
    }
    const response: CanvasMediaTaskCreateResponse = {
      providerProfileId: 'profile',
      provider: 'provider',
      model: 'model',
      mode: 'sync',
      assets: [],
      ...responseFields,
    }
    const compilation: CanvasPromptCompilation = {
      ...responseFields,
      compiledUserText: responseFields.compiledUserText ?? '',
      inputSnapshots: [],
      relationManifest: [],
    }

    expect(JSON.parse(JSON.stringify(response))).toMatchObject(responseFields)
    expect(JSON.parse(JSON.stringify(compilation))).toEqual(compilation)
  })

  it('keeps bounded text resources when authored input explicitly maps to their ids', () => {
    const style = '写实都市 / 末日硬核 / 微胶片颗粒'
    const systemPrompt = `生成电影画面。全局风格要求：${style}`
    const userPrompt = [
      '[用户输入与引用关系]',
      '风格：文本引用 T1',
      '[/用户输入与引用关系]',
      '',
      '[引用资源]',
      '[文本引用 T1 开始]',
      '类型：文本',
      '名称：全局风格指引',
      '',
      style,
      '[/文本引用 T1 结束]',
      '[/引用资源]',
    ].join('\n')

    expect(composeCanvasMediaProviderPrompt({ systemPrompt, userPrompt }))
      .toBe(`${systemPrompt}\n\n${userPrompt}`)
  })
})
