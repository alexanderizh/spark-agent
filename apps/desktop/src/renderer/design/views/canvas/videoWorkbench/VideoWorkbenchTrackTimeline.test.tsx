// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('antd', () => ({
  Button: ({
    children,
    icon,
    danger: _danger,
    loading: _loading,
    size: _size,
    ...props
  }: {
    children?: ReactNode
    icon?: ReactNode
    danger?: boolean
    loading?: boolean
    size?: string
  } & Record<string, unknown>) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('../../../Icons', () => ({
  Icons: new Proxy({}, { get: () => () => <span /> }),
}))

vi.mock('./VideoWorkbenchResourceThumb', () => ({
  ResourceThumb: () => <span />,
}))

import { VideoWorkbenchTrackTimeline } from './VideoWorkbenchTrackTimeline'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let mounted: { root: ReturnType<typeof createRoot>; container: HTMLElement } | null = null

afterEach(async () => {
  if (!mounted) return
  await act(async () => mounted?.root.unmount())
  mounted.container.remove()
  mounted = null
})

describe('VideoWorkbenchTrackTimeline zoom', () => {
  it('starts at approximately 30 percent of the timeline scale', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted = { root, container }

    await act(async () => {
      root.render(
        <VideoWorkbenchTrackTimeline
          track={[]}
          resources={[]}
          busy={false}
          onReorder={() => undefined}
          onRemoveClip={() => undefined}
          selectedClipId={null}
          onSelectClip={() => undefined}
          onPreviewResource={() => undefined}
          onAddResourceToTrack={() => undefined}
          onClearTrack={() => undefined}
          onOpenFrames={() => undefined}
          onOpenEdit={() => undefined}
          onOpenOutput={() => undefined}
          onSplitAtPlayhead={() => undefined}
          onDurationChange={() => undefined}
          playback={{
            active: false,
            playing: false,
            currentClipId: null,
            globalTimeSec: 0,
            totalDurationSec: 0,
          }}
          onPlaybackSeek={() => undefined}
          onPlaybackToggle={() => undefined}
        />,
      )
    })

    const slider = container.querySelector<HTMLInputElement>('input[aria-label="时间轴缩放比例"]')
    expect(slider?.min).toBe('8')
    expect(slider?.value).toBe('56')
  })

  it('reports the clicked segment as selected', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted = { root, container }
    const onSelectClip = vi.fn()
    const onPlaybackSeek = vi.fn()

    await act(async () => {
      root.render(
        <VideoWorkbenchTrackTimeline
          track={[{ id: 'clip-a', resourceId: 'resource-a', order: 0 }]}
          resources={[
            {
              id: 'resource-a',
              source: 'local',
              kind: 'video',
              title: 'Video A',
              url: 'safe-file:///video-a.mp4',
              originPath: '/video-a.mp4',
              durationSec: 12,
              importedAt: 0,
            },
          ]}
          busy={false}
          onReorder={() => undefined}
          onRemoveClip={() => undefined}
          selectedClipId={null}
          onSelectClip={onSelectClip}
          onPreviewResource={() => undefined}
          onAddResourceToTrack={() => undefined}
          onClearTrack={() => undefined}
          onOpenFrames={() => undefined}
          onOpenEdit={() => undefined}
          onOpenOutput={() => undefined}
          onSplitAtPlayhead={() => undefined}
          onDurationChange={() => undefined}
          playback={{
            active: false,
            playing: false,
            currentClipId: null,
            globalTimeSec: 0,
            totalDurationSec: 12,
          }}
          onPlaybackSeek={onPlaybackSeek}
          onPlaybackToggle={() => undefined}
        />,
      )
    })

    await act(async () => {
      const clip = container.querySelector<HTMLElement>('[data-clip-id="clip-a"]')
      clip?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }))
      clip?.click()
    })

    expect(onSelectClip).toHaveBeenCalledWith('clip-a')
    expect(onPlaybackSeek).not.toHaveBeenCalled()
  })
})
