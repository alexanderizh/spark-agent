// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDefaultVideoWorkbenchProject,
  createDefaultVideoWorkbenchTrack,
  type VideoWorkbenchProjectV2,
  type VideoWorkbenchResourceV2,
} from './projectTypes'
import { useVideoWorkbenchProjectSession } from './useVideoWorkbenchProjectSession'
import { backfillVideoWorkbenchProjectResourceMetadata } from './resourceMetadata'
import { backfillResourceMetadata } from '../resourcePanelUtils'
import type { VideoProbeInfo, VideoWorkbenchData, WorkbenchOutput } from '../videoWorkbench.types'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROBE_FIXTURE: VideoProbeInfo = {
  durationSec: 21.5,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
  hasAudio: true,
  bitrate: 3_500_000,
  fileSize: 9_400_000,
}

function buildProjectWithSourcePlaceholder(): VideoWorkbenchProjectV2 {
  const project = createDefaultVideoWorkbenchProject()
  const resource: VideoWorkbenchResourceV2 = {
    id: 'source:node-1',
    source: 'canvas',
    kind: 'video',
    title: '源视频',
    url: 'safe-file:///source.mp4',
    originPath: '/source.mp4',
    importedAt: 1,
  }
  project.resources = [resource]
  project.tracks[0]!.clips = [
    {
      id: 'clip:source',
      resourceId: resource.id,
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

function Harness({
  raw,
  onSave,
  onSession,
}: {
  raw: unknown
  onSave: (project: unknown) => Promise<void>
  /** 暴露 session 上的回归动作（同一 click 内连续提交，还原真实交互） */
  onSession?: ((session: ReturnType<typeof useVideoWorkbenchProjectSession>) => void) | undefined
}) {
  const session = useVideoWorkbenchProjectSession({
    raw,
    open: true,
    onSave: onSave as (
      project: ReturnType<typeof createDefaultVideoWorkbenchProject>,
    ) => Promise<void>,
  })
  return (
    <div>
      <span data-testid="track-count">{session.project.tracks.length}</span>
      <span data-testid="width">{session.project.project.width}</span>
      <span data-testid="readonly">{String(session.readOnly)}</span>
      <span data-testid="clip-duration">
        {session.project.tracks[0]?.clips[0]?.durationSec ?? 'none'}
      </span>
      <span data-testid="probe-duration">{session.project.probeInfo?.durationSec ?? 'none'}</span>
      <span data-testid="resource-duration">
        {session.project.resources[0]?.durationSec ?? 'none'}
      </span>
      <span data-testid="outputs-count">{session.project.outputs.length}</span>
      <button
        type="button"
        onClick={() =>
          session.applyCommand({
            type: 'track/add',
            track: createDefaultVideoWorkbenchTrack('audio', 'track:audio', 'Audio', 1),
          })
        }
      >
        add
      </button>
      <button type="button" onClick={session.undo}>
        undo
      </button>
      <button type="button" onClick={session.redo}>
        redo
      </button>
      <button
        type="button"
        onClick={() =>
          session.updateProject((project) => ({
            ...project,
            project: { ...project.project, width: 720 },
          }))
        }
      >
        resize
      </button>
      {onSession && (
        <button type="button" onClick={() => onSession(session)}>
          sequence
        </button>
      )}
    </div>
  )
}

let mounted: { root: ReturnType<typeof createRoot>; container: HTMLElement } | null = null

afterEach(async () => {
  vi.useRealTimers()
  if (!mounted) return
  await act(async () => mounted?.root.unmount())
  mounted.container.remove()
  mounted = null
})

async function renderHarness(
  raw: unknown,
  onSave: (project: unknown) => Promise<void>,
  onSession?: (session: ReturnType<typeof useVideoWorkbenchProjectSession>) => void,
): Promise<HTMLButtonElement[]> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted = { root, container }
  await act(async () => root.render(<Harness raw={raw} onSave={onSave} onSession={onSession} />))
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
}

describe('useVideoWorkbenchProjectSession', () => {
  it('records commands in bounded history and persists the V2 project', async () => {
    vi.useFakeTimers()
    const onSave = vi.fn(async () => undefined)
    const buttons = await renderHarness(createDefaultVideoWorkbenchProject(), onSave)

    await act(async () => buttons[0]?.click())
    expect(document.querySelector('[data-testid="track-count"]')?.textContent).toBe('2')
    await act(async () => vi.runAllTimersAsync())
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: 2 }))

    await act(async () => buttons[1]?.click())
    expect(document.querySelector('[data-testid="track-count"]')?.textContent).toBe('1')
    await act(async () => buttons[2]?.click())
    expect(document.querySelector('[data-testid="track-count"]')?.textContent).toBe('2')
    await act(async () => buttons[3]?.click())
    expect(document.querySelector('[data-testid="track-count"]')?.textContent).toBe('2')
    expect(document.querySelector('[data-testid="width"]')?.textContent).toBe('720')
  })

  it('blocks all project mutations and persistence for unsupported future versions', async () => {
    vi.useFakeTimers()
    const onSave = vi.fn(async () => undefined)
    const buttons = await renderHarness({ schemaVersion: 99 }, onSave)

    expect(document.querySelector('[data-testid="readonly"]')?.textContent).toBe('true')
    await act(async () => {
      buttons[0]?.click()
      buttons[3]?.click()
      await vi.runAllTimersAsync()
    })
    expect(document.querySelector('[data-testid="track-count"]')?.textContent).toBe('1')
    expect(document.querySelector('[data-testid="width"]')?.textContent).toBe('1920')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('composes the probe backfill with the legacy draft update committed in the same tick', async () => {
    // 还原 CanvasVideoWorkbenchModal.probeAndUpdate：probe 成功后先 updateProject 扩展
    // 占位 clip，紧接着 updateLegacyDraft 写 probeInfo / resourcePanel。两次提交在同一
    // tick 内，若后者基于过期快照整体覆盖，clip 会永远停在 8s 占位（右键进入工作台
    // 默认视频时长错误的根因）。
    vi.useFakeTimers()
    const onSave = vi.fn(async () => undefined)
    const buttons = await renderHarness(buildProjectWithSourcePlaceholder(), onSave, (session) => {
      const sourceResourceId = 'source:node-1'
      session.updateProject((current) =>
        backfillVideoWorkbenchProjectResourceMetadata(
          current,
          new Map([[sourceResourceId, PROBE_FIXTURE]]),
        ),
      )
      session.updateLegacyDraft((d) => ({
        ...d,
        probeInfo: PROBE_FIXTURE,
        resourcePanel: backfillResourceMetadata(d.resourcePanel, sourceResourceId, PROBE_FIXTURE),
      }))
    })

    await act(async () => buttons[4]?.click())
    expect(document.querySelector('[data-testid="clip-duration"]')?.textContent).toBe('21.5')
    expect(document.querySelector('[data-testid="probe-duration"]')?.textContent).toBe('21.5')
    expect(document.querySelector('[data-testid="resource-duration"]')?.textContent).toBe('21.5')
  })

  it('composes consecutive per-segment output recordings committed in the same tick', async () => {
    // 还原等分切割产物记录：VideoWorkbenchEditPanel 对每段产物各调一次 onOutput，
    // 多次提交在同一 tick 内必须全部叠加，不能只剩最后一段。
    vi.useFakeTimers()
    const onSave = vi.fn(async () => undefined)
    const buttons = await renderHarness(buildProjectWithSourcePlaceholder(), onSave, (session) => {
      const paths = ['/seg_000.mp4', '/seg_001.mp4', '/seg_002.mp4']
      for (const path of paths) {
        const output: WorkbenchOutput = {
          id: path,
          type: 'segment',
          outputPath: path,
          outputUrl: path,
          createdAt: 1,
          summary: '分割 × 10s',
        }
        session.updateLegacyDraft((d: VideoWorkbenchData) => ({
          ...d,
          outputs: [output, ...d.outputs],
        }))
      }
    })

    await act(async () => buttons[4]?.click())
    expect(document.querySelector('[data-testid="outputs-count"]')?.textContent).toBe('3')
  })
})
