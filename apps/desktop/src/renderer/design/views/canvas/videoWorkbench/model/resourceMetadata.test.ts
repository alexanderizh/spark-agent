import { describe, expect, it } from 'vitest'
import { createDefaultVideoWorkbenchProject } from './projectTypes'
import {
  backfillVideoWorkbenchProjectResourceMetadata,
  repairVideoWorkbenchSourcePlaceholderClips,
} from './resourceMetadata'

describe('video workbench resource metadata backfill', () => {
  it('expands untouched audio placeholders when the real duration becomes available', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [
      {
        id: 'audio:1',
        source: 'local',
        kind: 'audio',
        title: 'Audio',
        url: 'safe-file:///audio.wav',
        originPath: '/audio.wav',
        importedAt: 1,
      },
    ]
    const audioTrack = {
      ...project.tracks[0]!,
      id: 'track:audio',
      kind: 'audio' as const,
      clips: [
        {
          id: 'clip:1',
          resourceId: 'audio:1',
          timelineStartSec: 3,
          sourceInSec: 0,
          sourceOutSec: 8,
          durationSec: 8,
          speed: 1,
          enabled: true,
        },
      ],
    }
    project.tracks.push(audioTrack)

    const next = backfillVideoWorkbenchProjectResourceMetadata(
      project,
      new Map([['audio:1', { durationSec: 42 }]]),
    )
    expect(next.resources[0]!.durationSec).toBe(42)
    expect(next.tracks[1]!.clips[0]).toEqual(
      expect.objectContaining({ timelineStartSec: 3, sourceOutSec: 42, durationSec: 42 }),
    )
  })

  it.each([0, 0.1, 8])(
    'repairs zero-duration resources and their untouched %s-second placeholder clips',
    (placeholderDurationSec) => {
      const project = createDefaultVideoWorkbenchProject()
      project.resources = [
        {
          id: 'video:zero',
          source: 'canvas',
          kind: 'video',
          title: 'Video',
          url: 'safe-file:///video.mp4',
          originPath: '/video.mp4',
          importedAt: 1,
          durationSec: 0,
        },
      ]
      project.tracks[0]!.clips = [
        {
          id: 'clip:zero',
          resourceId: 'video:zero',
          timelineStartSec: 0,
          sourceInSec: 0,
          sourceOutSec: placeholderDurationSec,
          durationSec: placeholderDurationSec,
          speed: 1,
          enabled: true,
        },
      ]

      const next = backfillVideoWorkbenchProjectResourceMetadata(
        project,
        new Map([['video:zero', { durationSec: 24 }]]),
      )

      expect(next.resources[0]!.durationSec).toBe(24)
      expect(next.tracks[0]!.clips[0]).toEqual(
        expect.objectContaining({ sourceOutSec: 24, durationSec: 24 }),
      )
    },
  )

  it('keeps consecutive main-track placeholders adjacent after both durations are discovered', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [
      {
        id: 'video:first',
        source: 'canvas',
        kind: 'video',
        title: 'First',
        url: 'safe-file:///first.mp4',
        originPath: '/first.mp4',
        importedAt: 1,
        durationSec: 0,
      },
      {
        id: 'video:second',
        source: 'canvas',
        kind: 'video',
        title: 'Second',
        url: 'safe-file:///second.mp4',
        originPath: '/second.mp4',
        importedAt: 2,
        durationSec: 0,
      },
    ]
    project.tracks[0]!.clips = [
      {
        id: 'clip:first',
        resourceId: 'video:first',
        timelineStartSec: 0,
        sourceInSec: 0,
        sourceOutSec: 8,
        durationSec: 8,
        speed: 1,
        enabled: true,
      },
      {
        id: 'clip:second',
        resourceId: 'video:second',
        timelineStartSec: 8,
        sourceInSec: 0,
        sourceOutSec: 8,
        durationSec: 8,
        speed: 1,
        enabled: true,
      },
    ]

    const next = backfillVideoWorkbenchProjectResourceMetadata(
      project,
      new Map([
        ['video:first', { durationSec: 24 }],
        ['video:second', { durationSec: 3 }],
      ]),
    )

    expect(next.tracks[0]!.clips).toEqual([
      expect.objectContaining({ id: 'clip:first', timelineStartSec: 0, durationSec: 24 }),
      expect.objectContaining({ id: 'clip:second', timelineStartSec: 24, durationSec: 3 }),
    ])
  })

  it('does not overwrite a clip that the user already trimmed', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [
      {
        id: 'video:1',
        source: 'local',
        kind: 'video',
        title: 'Video',
        url: 'safe-file:///video.mp4',
        originPath: '/video.mp4',
        importedAt: 1,
      },
    ]
    project.tracks[0]!.clips = [
      {
        id: 'clip:1',
        resourceId: 'video:1',
        timelineStartSec: 0,
        sourceInSec: 1,
        sourceOutSec: 6,
        durationSec: 5,
        speed: 1,
        enabled: true,
      },
    ]
    const next = backfillVideoWorkbenchProjectResourceMetadata(
      project,
      new Map([['video:1', { durationSec: 30 }]]),
    )
    expect(next.resources[0]!.durationSec).toBe(30)
    expect(next.tracks[0]!.clips[0]).toBe(project.tracks[0]!.clips[0])
  })

  it('expands the source placeholder clip when probe metadata arrives before the duration is backfilled', () => {
    // 还原「从视频节点首次打开工作台」场景：seed 阶段 resource 无 durationSec，
    // 主轨 clip 是 8s 占位；probe 成功后必须先走本函数扩展 clip，
    // 再回填 resource.durationSec（见 CanvasVideoWorkbenchModal probeAndUpdate）。
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [
      {
        id: 'source:node-1',
        source: 'canvas',
        kind: 'video',
        title: '源视频',
        url: 'safe-file:///source.mp4',
        originPath: '/source.mp4',
        importedAt: 1,
      },
    ]
    project.tracks[0]!.clips = [
      {
        id: 'clip:source',
        resourceId: 'source:node-1',
        timelineStartSec: 0,
        sourceInSec: 0,
        sourceOutSec: 8,
        durationSec: 8,
        speed: 1,
        enabled: true,
      },
    ]

    const next = backfillVideoWorkbenchProjectResourceMetadata(
      project,
      new Map([['source:node-1', { durationSec: 21.5, width: 1920, height: 1080 }]]),
    )

    expect(next.resources[0]).toEqual(
      expect.objectContaining({
        durationSec: 21.5,
        width: 1920,
        height: 1080,
      }),
    )
    expect(next.tracks[0]!.clips[0]).toEqual(
      expect.objectContaining({ sourceOutSec: 21.5, durationSec: 21.5 }),
    )
  })

  it('does not expand the placeholder clip once the resource already carries a real duration', () => {
    // 顺序反了（先补 resource.durationSec 再 backfill）就不会扩展占位 clip ——
    // 这是修复前的缺陷形态，固化该保守行为以防回退。
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [
      {
        id: 'source:node-1',
        source: 'canvas',
        kind: 'video',
        title: '源视频',
        url: 'safe-file:///source.mp4',
        originPath: '/source.mp4',
        importedAt: 1,
        durationSec: 21.5,
      },
    ]
    project.tracks[0]!.clips = [
      {
        id: 'clip:source',
        resourceId: 'source:node-1',
        timelineStartSec: 0,
        sourceInSec: 0,
        sourceOutSec: 8,
        durationSec: 8,
        speed: 1,
        enabled: true,
      },
    ]

    const next = backfillVideoWorkbenchProjectResourceMetadata(
      project,
      new Map([['source:node-1', { durationSec: 21.5 }]]),
    )

    expect(next).toBe(project)
  })
})

describe('repairVideoWorkbenchSourcePlaceholderClips', () => {
  function buildPoisonedProject() {
    // 旧版本同步提交竞态固化的脏数据：resource 已带真实时长，源 clip 仍停在 8s 占位。
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [
      {
        id: 'source:node-1',
        source: 'canvas',
        kind: 'video',
        title: '源视频',
        url: 'safe-file:///source.mp4',
        originPath: '/source.mp4',
        importedAt: 1,
        durationSec: 21.5,
      },
    ]
    project.tracks[0]!.clips = [
      {
        id: 'clip:source',
        resourceId: 'source:node-1',
        timelineStartSec: 0,
        sourceInSec: 0,
        sourceOutSec: 8,
        durationSec: 8,
        speed: 1,
        enabled: true,
      },
    ]
    return project
  }

  it('expands a persisted source placeholder clip back to the resource duration', () => {
    const project = buildPoisonedProject()
    const next = repairVideoWorkbenchSourcePlaceholderClips(project, 'source:node-1')
    expect(next.tracks[0]!.clips[0]).toEqual(
      expect.objectContaining({ sourceOutSec: 21.5, durationSec: 21.5 }),
    )
  })

  it('keeps the project untouched when the resource has no duration yet', () => {
    const project = buildPoisonedProject()
    project.resources[0]!.durationSec = undefined
    expect(repairVideoWorkbenchSourcePlaceholderClips(project, 'source:node-1')).toBe(project)
  })

  it('does not touch clips the user already trimmed away from the placeholder value', () => {
    const project = buildPoisonedProject()
    project.tracks[0]!.clips = [
      { ...project.tracks[0]!.clips[0]!, sourceInSec: 1, sourceOutSec: 6, durationSec: 5 },
    ]
    expect(repairVideoWorkbenchSourcePlaceholderClips(project, 'source:node-1')).toBe(project)
  })

  it('does not touch clips whose duration already matches the resource', () => {
    const project = buildPoisonedProject()
    project.tracks[0]!.clips = [
      { ...project.tracks[0]!.clips[0]!, sourceOutSec: 21.5, durationSec: 21.5 },
    ]
    expect(repairVideoWorkbenchSourcePlaceholderClips(project, 'source:node-1')).toBe(project)
  })

  it('repairs duplicated source placeholders and keeps main-track clips adjacent', () => {
    const project = buildPoisonedProject()
    project.tracks[0]!.clips = [
      { ...project.tracks[0]!.clips[0]!, id: 'clip:a', timelineStartSec: 0 },
      { ...project.tracks[0]!.clips[0]!, id: 'clip:b', timelineStartSec: 8 },
    ]
    const next = repairVideoWorkbenchSourcePlaceholderClips(project, 'source:node-1')
    expect(next.tracks[0]!.clips).toEqual([
      expect.objectContaining({ id: 'clip:a', timelineStartSec: 0, durationSec: 21.5 }),
      expect.objectContaining({ id: 'clip:b', timelineStartSec: 21.5, durationSec: 21.5 }),
    ])
  })
})
