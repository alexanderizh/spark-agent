import { describe, expect, it } from 'vitest'
import type { CanvasAsset, StepStudioState } from '../canvas.types'
import { createSequence, createSegment } from './stepStoryboardModel'
import {
  STEP_CLIP_ID_PREFIX,
  STEP_RESOURCE_ID_PREFIX,
  applyAssemblyToProject,
  collectAssemblySources,
  estimateAssemblyDurationSec,
  type StepAssemblySource,
} from './stepAssemblyModel'
import { createDefaultVideoWorkbenchProject } from '../videoWorkbench/model/projectTypes'

function videoAsset(id: string, durationMs?: number): CanvasAsset {
  return {
    id,
    type: 'video',
    title: `视频 ${id}`,
    url: `https://x/${id}.mp4`,
    storageKey: `assets/${id}.mp4`,
    ...(durationMs != null ? { durationMs } : {}),
  } as unknown as CanvasAsset
}

function stateWithDoneSegments(): StepStudioState {
  const seq = createSequence('p1', 0, '第一集')
  const done = {
    ...createSegment(seq.id, 0),
    status: 'done' as const,
    outputVideoAssetIds: ['v1'],
  }
  const doneTwoOutputs = {
    ...createSegment(seq.id, 1),
    status: 'done' as const,
    // 最新产物在前也一样：收集时取最后一个 video
    outputVideoAssetIds: ['img-x', 'v2'],
  }
  const pending = { ...createSegment(seq.id, 2), status: 'generating' as const }
  return {
    schemaVersion: 1,
    sequences: [{ ...seq, segments: [done, doneTwoOutputs, pending] }],
  }
}

describe('collectAssemblySources', () => {
  it('只收 done 段并解析其 video 产物', () => {
    const assets = new Map([
      ['v1', videoAsset('v1', 5000)],
      ['v2', videoAsset('v2', 3000)],
    ])
    const sources = collectAssemblySources(stateWithDoneSegments(), assets)
    expect(sources).toHaveLength(2)
    expect(sources[0]!.videoAsset.id).toBe('v1')
    expect(sources[0]!.durationSec).toBe(5)
    expect(sources[1]!.videoAsset.id).toBe('v2')
  })

  it('产物缺失或非 video 时跳过该段', () => {
    const assets = new Map([
      ['v1', videoAsset('v1', 5000)],
      ['img-x', { id: 'img-x', type: 'image' } as unknown as CanvasAsset],
    ])
    const sources = collectAssemblySources(stateWithDoneSegments(), assets)
    expect(sources.map((s) => s.segmentId)).toHaveLength(1)
  })

  it('按序列与分段 order 排序输出', () => {
    const seqB = createSequence('p1', 1, '第二集')
    const state: StepStudioState = {
      schemaVersion: 1,
      sequences: [
        {
          ...seqB,
          segments: [{ ...createSegment(seqB.id, 0), status: 'done', outputVideoAssetIds: ['vb'] }],
        },
        ...stateWithDoneSegments().sequences,
      ],
    }
    const assets = new Map([
      ['v1', videoAsset('v1')],
      ['v2', videoAsset('v2')],
      ['vb', videoAsset('vb')],
    ])
    const sources = collectAssemblySources(state, assets)
    expect(sources.map((s) => s.sequenceTitle)).toEqual(['第一集', '第一集', '第二集'])
  })
})

describe('applyAssemblyToProject', () => {
  const sourcesFor = (assets: [string, number][]): StepAssemblySource[] => {
    const assetMap = new Map(assets.map(([id, ms]) => [id, videoAsset(id, ms)]))
    const state: StepStudioState = {
      schemaVersion: 1,
      sequences: assets.map(([id], index) => ({
        ...createSequence('p1', 0, '第一集'),
        segments: [
          { ...createSegment('s', index), status: 'done' as const, outputVideoAssetIds: [id] },
        ],
      })),
    }
    return collectAssemblySources(state, assetMap)
  }

  it('空数据落默认工程且无 step 资源', () => {
    const project = applyAssemblyToProject(undefined, [])
    expect(project.resources).toHaveLength(0)
    expect(project.tracks.length).toBeGreaterThan(0)
  })

  it('按顺序铺主轨并累加时间线，clip/resource 用 step 前缀 id', () => {
    const sources = sourcesFor([
      ['v1', 4000],
      ['v2', 2000],
    ])
    const project = applyAssemblyToProject(undefined, sources)
    expect(project.resources.map((r) => r.id)).toEqual([
      `${STEP_RESOURCE_ID_PREFIX}${sources[0]!.segmentId}`,
      `${STEP_RESOURCE_ID_PREFIX}${sources[1]!.segmentId}`,
    ])
    const clips = project.tracks
      .flatMap((t) => t.clips)
      .sort((a, b) => a.timelineStartSec - b.timelineStartSec)
    expect(clips.map((c) => c.id)).toEqual([
      `${STEP_CLIP_ID_PREFIX}${sources[0]!.segmentId}`,
      `${STEP_CLIP_ID_PREFIX}${sources[1]!.segmentId}`,
    ])
    expect(clips[0]!.timelineStartSec).toBe(0)
    expect(clips[0]!.durationSec).toBe(4)
    expect(clips[1]!.timelineStartSec).toBe(4)
  })

  it('重组装替换旧 step 项但保留用户手动内容', () => {
    const first = applyAssemblyToProject(undefined, sourcesFor([['v1', 4000]]))
    // 用户手动加内容：一个自有 resource + 主轨追加一个 clip
    first.resources.push({ ...first.resources[0]!, id: 'user-res', title: '用户素材' })
    const mainTrack = first.tracks.find((t) => t.kind === 'video')!
    const userClip = {
      ...mainTrack.clips[0]!,
      id: 'user-clip',
      resourceId: 'user-res',
      timelineStartSec: 99,
    }
    mainTrack.clips.push(userClip)

    // 重组装：产物换成 v2
    const second = applyAssemblyToProject(first, sourcesFor([['v2', 3000]]))
    expect(second.resources.some((r) => r.id === 'user-res')).toBe(true)
    expect(second.resources.some((r) => r.id.startsWith(STEP_RESOURCE_ID_PREFIX))).toBe(true)
    const clips = second.tracks.flatMap((t) => t.clips)
    expect(clips.some((c) => c.id === 'user-clip')).toBe(true)
    expect(clips.filter((c) => c.id.startsWith(STEP_CLIP_ID_PREFIX))).toHaveLength(1)
    // 新 step clip 铺在保留的用户片段之后，不重叠
    const stepClip = clips.find((c) => c.id.startsWith(STEP_CLIP_ID_PREFIX))!
    expect(stepClip.timelineStartSec).toBeGreaterThanOrEqual(
      userClip.timelineStartSec + userClip.durationSec,
    )
  })

  it('损坏的既有工程容错为默认工程后组装', () => {
    const project = applyAssemblyToProject({ garbage: true }, sourcesFor([['v1', 4000]]))
    expect(project.resources).toHaveLength(1)
    expect(project.schemaVersion).toBe(2)
  })

  it('sources 清空时仅回收 step 项', () => {
    const first = applyAssemblyToProject(undefined, sourcesFor([['v1', 4000]]))
    first.resources.push({ ...first.resources[0]!, id: 'user-res', title: '用户素材' })
    const cleaned = applyAssemblyToProject(first, [])
    expect(cleaned.resources.map((r) => r.id)).toEqual(['user-res'])
    expect(cleaned.tracks.flatMap((t) => t.clips)).toHaveLength(0)
  })

  it('重组装保留用户对 step clip 的手动裁剪（产物未变）', () => {
    const sources = sourcesFor([['v1', 4000]])
    const first = applyAssemblyToProject(undefined, sources)
    // 模拟用户在工作台精剪：裁剪入出点 + 变速 + 时间线挪位 + 变换/淡入出
    const stepClip = first.tracks.flatMap((t) => t.clips)[0]!
    stepClip.sourceInSec = 1
    stepClip.sourceOutSec = 3
    stepClip.durationSec = 2
    stepClip.speed = 1
    stepClip.timelineStartSec = 7
    stepClip.fadeInSec = 0.5
    stepClip.transform = {
      x: 1,
      y: 2,
      scaleX: 1.1,
      scaleY: 1,
      rotationDeg: 5,
      opacity: 0.8,
      mirrorX: false,
      mirrorY: false,
    }

    // 同产物重组装（如新增/删除其他段触发）：已精剪 clip 必须原样保留
    const second = applyAssemblyToProject(first, sources)
    const clip = second.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id.startsWith(STEP_CLIP_ID_PREFIX))!
    expect(clip.sourceInSec).toBe(1)
    expect(clip.sourceOutSec).toBe(3)
    expect(clip.durationSec).toBe(2)
    expect(clip.timelineStartSec).toBe(7)
    expect(clip.fadeInSec).toBe(0.5)
    expect(clip.transform?.rotationDeg).toBe(5)
  })

  it('产物已变时迁移风格性编辑、裁剪回默认并重新起位', () => {
    // 固定 segmentId（两次组装同段重生成，仅产物资产变化）
    const fixedSource = (assetId: string, ms: number): StepAssemblySource => ({
      sequenceId: 'seq-fixed',
      sequenceTitle: '第一集',
      segmentId: 'seg-fixed',
      segmentOrder: 0,
      videoAsset: videoAsset(assetId, ms),
      durationSec: ms / 1000,
    })

    const first = applyAssemblyToProject(undefined, [fixedSource('v1', 4000)])
    const stepClip = first.tracks.flatMap((t) => t.clips)[0]!
    stepClip.sourceInSec = 1
    stepClip.sourceOutSec = 3
    stepClip.speed = 2
    stepClip.timelineStartSec = 7
    stepClip.fadeOutSec = 0.2
    stepClip.enabled = false

    // 重新生成后产物换成 v2（3s）：裁剪点针对旧内容不迁移，风格编辑保留
    const second = applyAssemblyToProject(first, [fixedSource('v2', 3000)])
    const clip = second.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id.startsWith(STEP_CLIP_ID_PREFIX))!
    expect(clip.sourceInSec).toBe(0)
    expect(clip.sourceOutSec).toBe(3)
    expect(clip.speed).toBe(2)
    expect(clip.durationSec).toBeCloseTo(1.5, 6)
    expect(clip.timelineStartSec).toBe(0)
    expect(clip.fadeOutSec).toBe(0.2)
    expect(clip.enabled).toBe(false)
  })

  it('工程设置保留（分辨率/帧率等不被重置）', () => {
    const base = createDefaultVideoWorkbenchProject()
    base.project.width = 999
    const project = applyAssemblyToProject(base, sourcesFor([['v1', 4000]]))
    expect(project.project.width).toBe(999)
  })
})

describe('estimateAssemblyDurationSec', () => {
  it('累加已知时长，未知按 0 计', () => {
    expect(
      estimateAssemblyDurationSec([
        { durationSec: 2.5 } as StepAssemblySource,
        { durationSec: undefined } as StepAssemblySource,
      ]),
    ).toBe(2.5)
  })
})
