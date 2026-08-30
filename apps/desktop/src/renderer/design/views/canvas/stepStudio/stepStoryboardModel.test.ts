import { describe, expect, it } from 'vitest'
import type { CanvasAsset, CanvasSnapshot, StepShotSegment, StepStudioState } from '../canvas.types'
import {
  addSegment,
  applyMention,
  breakdownDraftToSegment,
  buildScriptBreakdownPrompt,
  buildStepSegmentPrompt,
  collectSegmentInputFiles,
  createSegment,
  createSequence,
  detectMentionQuery,
  deriveSegmentRuntime,
  filterMentionOptions,
  isSegmentGeneratable,
  moveSegment,
  normalizeSequences,
  reorderSegment,
  parseBreakdownDrafts,
  patchSegment,
  removeSegment,
  removeSequence,
  upsertSequence,
} from './stepStoryboardModel'

function baseState(): StepStudioState {
  return { schemaVersion: 1, sequences: [] }
}

function seqA(): ReturnType<typeof createSequence> {
  const seq = createSequence('p1', 0, '第一集')
  return {
    ...seq,
    segments: [
      { ...createSegment(seq.id, 0), script: '开场' },
      { ...createSegment(seq.id, 1), script: '高潮' },
    ],
  }
}

describe('sequence CRUD', () => {
  it('createSequence 生成缺省标题与空分段', () => {
    const seq = createSequence('p1', 0)
    expect(seq.title).toBe('第 1 集')
    expect(seq.segments).toEqual([])
    expect(seq.projectId).toBe('p1')
  })

  it('removeSequence 后重排 order 保持连续', () => {
    let state = baseState()
    state = upsertSequence(state, seqA())
    state = upsertSequence(state, createSequence('p1', 1, '第二集'))
    state = removeSequence(state, state.sequences[0]!.id)
    expect(state.sequences).toHaveLength(1)
    expect(state.sequences[0]!.order).toBe(0)
  })
})

describe('segment CRUD', () => {
  it('addSegment 追加到末尾并落 order', () => {
    let state = upsertSequence(baseState(), seqA())
    state = addSegment(state, state.sequences[0]!.id)
    const segments = state.sequences[0]!.segments
    expect(segments).toHaveLength(3)
    expect(segments[2]!.order).toBe(2)
    expect(segments[2]!.status).toBe('draft')
  })

  it('removeSegment 后 order 重排连续', () => {
    let state = upsertSequence(baseState(), seqA())
    const seqId = state.sequences[0]!.id
    state = removeSegment(state, seqId, state.sequences[0]!.segments[0]!.id)
    const segments = state.sequences[0]!.segments
    expect(segments).toHaveLength(1)
    expect(segments[0]!.script).toBe('高潮')
    expect(segments[0]!.order).toBe(0)
  })

  it('moveSegment 上下移交换并重排 order', () => {
    let state = upsertSequence(baseState(), seqA())
    const seqId = state.sequences[0]!.id
    const secondId = state.sequences[0]!.segments[1]!.id
    state = moveSegment(state, seqId, secondId, 'up')
    expect(state.sequences[0]!.segments[0]!.script).toBe('高潮')
    expect(state.sequences[0]!.segments.map((seg) => seg.order)).toEqual([0, 1])
  })

  it('moveSegment 越界时不变更', () => {
    const state = upsertSequence(baseState(), seqA())
    const seqId = state.sequences[0]!.id
    const firstId = state.sequences[0]!.segments[0]!.id
    const after = moveSegment(state, seqId, firstId, 'up')
    expect(after).toEqual(state)
  })

  it('reorderSegment 拖到指定位置并重排 order', () => {
    let state = upsertSequence(baseState(), seqA())
    const seqId = state.sequences[0]!.id
    state = addSegment(state, seqId)
    state = patchSegment(state, seqId, state.sequences[0]!.segments[2]!.id, { script: '结尾' })
    const firstId = state.sequences[0]!.segments[0]!.id
    state = reorderSegment(state, seqId, firstId, 2)
    expect(state.sequences[0]!.segments.map((seg) => seg.script)).toEqual(['高潮', '结尾', '开场'])
    expect(state.sequences[0]!.segments.map((seg) => seg.order)).toEqual([0, 1, 2])
  })

  it('reorderSegment 目标越界时钳制、同位与未知分段不变更', () => {
    const state = upsertSequence(baseState(), seqA())
    const seqId = state.sequences[0]!.id
    const firstId = state.sequences[0]!.segments[0]!.id
    const clamped = reorderSegment(state, seqId, firstId, 99)
    // 越界钳制到末位（length-1）：移到 1 等价于移到末尾
    expect(clamped.sequences[0]!.segments.map((seg) => seg.script)).toEqual(['高潮', '开场'])
    expect(reorderSegment(state, seqId, firstId, 0)).toEqual(state)
    expect(reorderSegment(state, seqId, 'seg_unknown', 1)).toEqual(state)
  })

  it('patchSegment 只影响目标分段', () => {
    let state = upsertSequence(baseState(), seqA())
    const seqId = state.sequences[0]!.id
    const targetId = state.sequences[0]!.segments[0]!.id
    state = patchSegment(state, seqId, targetId, { status: 'done' })
    expect(state.sequences[0]!.segments[0]!.status).toBe('done')
    expect(state.sequences[0]!.segments[1]!.status).toBe('draft')
  })
})

describe('normalizeSequences 容错', () => {
  it('丢弃非法项并补齐缺省字段', () => {
    const normalized = normalizeSequences([
      { id: 's1', title: '', segments: [{ id: 'g1', script: 123, genMode: 'first_last_frame' }] },
      null,
      { nope: 1 },
    ])
    expect(normalized).toHaveLength(1)
    const seq = normalized[0]!
    expect(seq.title).toBe('未命名')
    expect(seq.segments[0]!.script).toBe('')
    expect(seq.segments[0]!.genMode).toBe('first_last_frame')
    expect(seq.segments[0]!.status).toBe('draft')
  })

  it('非法 status 回落 draft', () => {
    const normalized = normalizeSequences([{ id: 's1', segments: [{ id: 'g1', status: 'bogus' }] }])
    expect(normalized[0]!.segments[0]!.status).toBe('draft')
  })
})

describe('deriveSegmentRuntime', () => {
  const segment: StepShotSegment = { ...createSegment('s1', 0), taskId: 't1', status: 'generating' }

  function snapshotWith(
    task: Record<string, unknown> | null,
    assets: CanvasAsset[] = [],
  ): CanvasSnapshot {
    return {
      tasks: task ? ([task] as unknown as CanvasSnapshot['tasks']) : [],
      assets,
    } as CanvasSnapshot
  }

  it('running 任务派生 generating 并读进度', () => {
    const runtime = deriveSegmentRuntime(
      segment,
      snapshotWith({ id: 't1', status: 'running', progress: 42, outputAssetIds: [] }),
    )
    expect(runtime.status).toBe('generating')
    expect(runtime.progress).toBe(42)
  })

  it('completed 任务派生 done 并取最新 video 产物', () => {
    const assets = [
      { id: 'a1', type: 'image' },
      { id: 'a2', type: 'video' },
    ] as CanvasAsset[]
    const runtime = deriveSegmentRuntime(
      segment,
      snapshotWith({ id: 't1', status: 'completed', outputAssetIds: ['a1', 'a2'] }, assets),
    )
    expect(runtime.status).toBe('done')
    expect(runtime.latestVideoAsset?.id).toBe('a2')
  })

  it('failed 任务提取 runtimeEvents.detail 错误信息', () => {
    const runtime = deriveSegmentRuntime(
      segment,
      snapshotWith({
        id: 't1',
        status: 'failed',
        outputAssetIds: [],
        runtimeEvents: [{ at: '', kind: 'failed', label: '生成失败', detail: '渠道限流' }],
      }),
    )
    expect(runtime.status).toBe('failed')
    expect(runtime.errorText).toBe('渠道限流')
  })

  it('cancelled 任务派生 failed', () => {
    const runtime = deriveSegmentRuntime(
      segment,
      snapshotWith({ id: 't1', status: 'cancelled', outputAssetIds: [] }),
    )
    expect(runtime.status).toBe('failed')
  })

  it('任务不存在时回落持久化 status 与历史产物', () => {
    const withHistory: StepShotSegment = {
      ...segment,
      taskId: null,
      status: 'done',
      outputVideoAssetIds: ['a2'],
    }
    const runtime = deriveSegmentRuntime(
      withHistory,
      snapshotWith(null, [{ id: 'a2', type: 'video' }] as CanvasAsset[]),
    )
    expect(runtime.status).toBe('done')
    expect(runtime.latestVideoAsset?.id).toBe('a2')
  })
})

describe('buildStepSegmentPrompt', () => {
  const character = {
    id: 'c1',
    title: '阿杜',
    type: 'image',
    metadata: { attributes: { 年龄: '30', 性格: '沉稳' } },
  } as unknown as CanvasAsset

  it('注入风格/出镜设定/剧本/时长', () => {
    const segment: StepShotSegment = {
      ...createSegment('s1', 0),
      script: '走进酒馆',
      characterAssetIds: ['c1'],
      durationSec: 5,
    }
    const prompt = buildStepSegmentPrompt(segment, new Map([['c1', character]]), '赛博朋克')
    expect(prompt).toContain('【整体风格】赛博朋克')
    expect(prompt).toContain('角色 阿杜')
    expect(prompt).toContain('年龄：30')
    expect(prompt).toContain('【本段剧本】')
    expect(prompt).toContain('走进酒馆')
    expect(prompt).toContain('约 5 秒')
  })

  it('空剧本落兜底文案不抛错', () => {
    const prompt = buildStepSegmentPrompt(createSegment('s1', 0), new Map(), '')
    expect(prompt).toContain('（未填写剧本')
    expect(prompt).not.toContain('【整体风格】')
  })
})

describe('collectSegmentInputFiles', () => {
  const imageAsset = (id: string, url?: string): CanvasAsset =>
    ({ id, type: 'image', url: url ?? `https://x/${id}.png` }) as unknown as CanvasAsset
  const filmAsset = (id: string, refs: string[]): CanvasAsset =>
    ({
      id,
      type: 'text',
      metadata: { references: refs.map((r, i) => ({ assetId: r, order: i })) },
    }) as unknown as CanvasAsset

  it('首尾帧模式精确传 role', () => {
    const segment: StepShotSegment = {
      ...createSegment('s1', 0),
      genMode: 'first_last_frame',
      firstFrameAssetId: 'f1',
      lastFrameAssetId: 'f2',
    }
    const files = collectSegmentInputFiles(
      segment,
      new Map([
        ['f1', imageAsset('f1')],
        ['f2', imageAsset('f2')],
      ]),
    )
    expect(files.map((f) => f.role)).toEqual(['first_frame', 'last_frame'])
  })

  it('reference 模式带出镜资产首图 + 追加参考图并去重', () => {
    const segment: StepShotSegment = {
      ...createSegment('s1', 0),
      genMode: 'reference',
      characterAssetIds: ['c1'],
      sceneAssetId: 'sc1',
      referenceAssetIds: ['r1', 'c1-img'],
    }
    const assetsById = new Map([
      ['c1', filmAsset('c1', ['c1-img'])],
      ['sc1', filmAsset('sc1', ['sc1-img'])],
      ['c1-img', imageAsset('c1-img')],
      ['sc1-img', imageAsset('sc1-img')],
      ['r1', imageAsset('r1')],
    ])
    const files = collectSegmentInputFiles(segment, assetsById)
    expect(files.map((f) => (f.url ?? '').split('/').pop())).toEqual([
      'c1-img.png',
      'sc1-img.png',
      'r1.png',
    ])
    expect(files.every((f) => f.role === 'reference')).toBe(true)
  })

  it('无可用图的资产不产生输入', () => {
    const segment: StepShotSegment = { ...createSegment('s1', 0), characterAssetIds: ['c1'] }
    const files = collectSegmentInputFiles(segment, new Map([['c1', filmAsset('c1', [])]]))
    expect(files).toEqual([])
  })
})

describe('isSegmentGeneratable', () => {
  it('生成中不可再生成', () => {
    const segment = { ...createSegment('s1', 0), script: 'x' }
    expect(isSegmentGeneratable(segment, 'generating')).toBe(false)
  })

  it('有剧本即可生成', () => {
    const segment = { ...createSegment('s1', 0), script: 'x' }
    expect(isSegmentGeneratable(segment, 'draft')).toBe(true)
  })

  it('无剧本时首尾帧模式看帧图、reference 模式看参考图', () => {
    const frames: StepShotSegment = {
      ...createSegment('s1', 0),
      genMode: 'first_last_frame',
      firstFrameAssetId: 'f1',
    }
    const refs: StepShotSegment = { ...createSegment('s1', 0), referenceAssetIds: ['r1'] }
    const nothing = createSegment('s1', 0)
    expect(isSegmentGeneratable(frames, 'draft')).toBe(true)
    expect(isSegmentGeneratable(refs, 'draft')).toBe(true)
    expect(isSegmentGeneratable(nothing, 'draft')).toBe(false)
  })
})

describe('detectMentionQuery', () => {
  it('检测光标处的 @ 查询（含中文）', () => {
    // 出(0)镜(1)' '(2)@(3)小(4)美(5)' '(6)：光标 6 仍在查询串内
    expect(detectMentionQuery('出镜 @小美 走进房间', 6)).toEqual({
      query: '小美',
      startIndex: 3,
    })
    // 光标越过空白后不再属于该提及
    expect(detectMentionQuery('出镜 @小美 走进房间', 7)).toBeNull()
  })

  it('仅键入 @ 时查询为空串', () => {
    expect(detectMentionQuery('画面 @', 4)).toEqual({ query: '', startIndex: 3 })
  })

  it('行首 @ 与光标越界处理', () => {
    expect(detectMentionQuery('@角', 2)).toEqual({ query: '角', startIndex: 0 })
    expect(detectMentionQuery('@角', 0)).toBeNull()
    expect(detectMentionQuery('@角', 99)).toBeNull()
  })

  it('空白中断与邮箱类文本不触发', () => {
    // @ 后有空白：光标停在空白后不再属于该提及
    expect(detectMentionQuery('喊 @小 美', 5)).toBeNull()
    // @ 前是非空白（邮箱中段）：不是提及起点
    expect(detectMentionQuery('mail a@b.com', 9)).toBeNull()
  })

  it('查询超长视为普通文本', () => {
    const text = `@${'长'.repeat(25)}`
    expect(detectMentionQuery(text, text.length)).toBeNull()
  })
})

describe('applyMention', () => {
  it('替换查询区间为 @名称 并返回新光标', () => {
    const result = applyMention('出镜 @小美 走进房间', 3, 6, '小美（雨夜）')
    expect(result.text).toBe('出镜 @小美（雨夜） 走进房间')
    expect(result.caret).toBe(3 + '@小美（雨夜） '.length)
  })

  it('清掉光标后的查询尾部残字', () => {
    // 光标停在查询中间：区间向后延伸到空白，残字一并替换
    const result = applyMention('出镜 @小美abc 走进', 3, 5, '小美')
    expect(result.text).toBe('出镜 @小美 走进')
  })
})

describe('filterMentionOptions', () => {
  const options = [
    { value: 'c1', label: '小美' },
    { value: 'c2', label: '小雨' },
    { value: 's1', label: '雨夜街道' },
  ]

  it('空查询返回前 limit 条，大小写不敏感包含匹配', () => {
    expect(filterMentionOptions(options, '')).toHaveLength(3)
    expect(filterMentionOptions(options, '', 2)).toHaveLength(2)
    expect(filterMentionOptions(options, '雨').map((o) => o.value)).toEqual(['c2', 's1'])
    expect(filterMentionOptions(options, '  小美 ')).toEqual([options[0]])
  })
})

describe('buildScriptBreakdownPrompt', () => {
  it('注入资产名单、剧本与严格 JSON 输出要求', () => {
    const prompt = buildScriptBreakdownPrompt('小美走进酒馆', {
      characters: ['小美'],
      scenes: ['雨夜街道'],
      props: [],
    })
    expect(prompt).toContain('角色：小美')
    expect(prompt).toContain('场景：雨夜街道')
    expect(prompt).toContain('道具：（无）')
    expect(prompt).toContain('小美走进酒馆')
    expect(prompt).toContain('[{"script"')
  })
})

describe('parseBreakdownDrafts', () => {
  it('解析裸 JSON 数组并保留各字段', () => {
    const drafts = parseBreakdownDrafts(
      '[{"script":"开场","durationSec":6,"characters":["小美"],"scene":"雨夜街道","props":["油纸伞"]}]',
    )
    expect(drafts).toEqual([
      {
        script: '开场',
        durationSec: 6,
        characterNames: ['小美'],
        sceneName: '雨夜街道',
        propNames: ['油纸伞'],
      },
    ])
  })

  it('容忍 ```json 围栏与前后解释文字', () => {
    const drafts = parseBreakdownDrafts('拆解如下：\n```json\n[{"script":"中段"}]\n```\n以上')
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.script).toBe('中段')
  })

  it('非 JSON / 非数组返回空，非法条目丢弃', () => {
    expect(parseBreakdownDrafts('不是 JSON')).toEqual([])
    expect(parseBreakdownDrafts('{"script":"对象而非数组"}')).toEqual([])
    expect(parseBreakdownDrafts('[]')).toEqual([])
    expect(
      parseBreakdownDrafts(
        '[{"script":"保留"},{"nope":1},{"script":""},{"script":"秒越界","durationSec":99}]',
      ),
    ).toEqual([
      { script: '保留', characterNames: [], sceneName: null, propNames: [] },
      { script: '秒越界', characterNames: [], sceneName: null, propNames: [] },
    ])
  })
})

describe('breakdownDraftToSegment', () => {
  const assets = [
    { id: 'c1', title: '小美', kind: 'character' },
    { id: 'c2', title: '小雨', kind: 'character' },
    { id: 'sc1', title: '雨夜街道', kind: 'scene' },
    { id: 'p1', title: '油纸伞', kind: 'prop' },
  ] as const

  it('名称精确/包含匹配写入引用字段并去重', () => {
    const segment = breakdownDraftToSegment(
      {
        script: '开场',
        durationSec: 6,
        characterNames: ['小美', '小', '无此角色'],
        sceneName: '街道',
        propNames: ['油纸伞', '油纸伞'],
      },
      'seq1',
      3,
      assets,
    )
    expect(segment.sequenceId).toBe('seq1')
    expect(segment.order).toBe(3)
    expect(segment.script).toBe('开场')
    expect(segment.durationSec).toBe(6)
    // '小美' 精确命中 c1；'小' 无精确但包含也命中 c1（去重）；'无此角色' 落空
    expect(segment.characterAssetIds).toEqual(['c1'])
    expect(segment.sceneAssetId).toBe('sc1')
    expect(segment.propAssetIds).toEqual(['p1'])
    expect(segment.status).toBe('draft')
  })

  it('无匹配/未填场景保持缺省形态', () => {
    const segment = breakdownDraftToSegment(
      { script: 'x', characterNames: [], sceneName: null, propNames: [] },
      'seq1',
      0,
      assets,
    )
    expect(segment.characterAssetIds).toEqual([])
    expect(segment.sceneAssetId).toBeNull()
    expect(segment.propAssetIds).toEqual([])
  })
})
