// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDefaultVideoWorkbenchProject,
  createDefaultVideoWorkbenchTrack,
} from '../model/projectTypes'

vi.mock('antd', () => ({
  Button: ({
    children,
    icon,
    loading: _loading,
    size: _size,
    type: _type,
    ...props
  }: {
    children?: ReactNode
    icon?: ReactNode
    loading?: boolean
    size?: string
    type?: string
  } & Record<string, unknown>) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  ),
  Switch: ({
    checked,
    onChange,
    ...props
  }: {
    checked: boolean
    onChange?: (checked: boolean) => void
  } & Record<string, unknown>) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange?.(event.currentTarget.checked)}
    />
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children,
  message: { info: vi.fn(), warning: vi.fn() },
}))

vi.mock('../../../../Icons', () => ({
  Icons: new Proxy({}, { get: () => () => <span /> }),
}))

vi.mock('../VideoWorkbenchResourceThumb', () => ({
  ResourceThumb: () => <span />,
}))

import { VideoWorkbenchMultiTrackTimeline } from './VideoWorkbenchMultiTrackTimeline'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let mounted: { root: ReturnType<typeof createRoot>; container: HTMLElement } | null = null

afterEach(async () => {
  if (!mounted) return
  await act(async () => mounted?.root.unmount())
  mounted.container.remove()
  mounted = null
})

describe('VideoWorkbenchMultiTrackTimeline', () => {
  it('renders visual/audio track heads and dispatches track controls', async () => {
    const project = createDefaultVideoWorkbenchProject()
    const audioTrack = createDefaultVideoWorkbenchTrack('audio', 'track:audio', '旁白', 1)
    audioTrack.order = 7
    project.tracks.push(audioTrack)
    const onCommand = vi.fn((command) => ({ applied: true as const, project, command }))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted = { root, container }

    await act(async () => {
      root.render(
        <VideoWorkbenchMultiTrackTimeline
          project={project}
          busy={false}
          readOnly={false}
          selectedClipIds={[]}
          playheadSec={0}
          playing={false}
          canUndo={false}
          canRedo={false}
          onSelectionChange={vi.fn()}
          onPreviewResource={vi.fn()}
          onSeek={vi.fn()}
          onPlaybackToggle={vi.fn()}
          onCommand={onCommand}
          onUpdateProject={vi.fn()}
          onUndo={vi.fn()}
          onRedo={vi.fn()}
          onOpenFrames={vi.fn()}
          onOpenEdit={vi.fn()}
          onOpenOutput={vi.fn()}
        />,
      )
    })

    for (const label of [
      '撤销',
      '重做',
      '分割',
      '复制所选',
      '删除所选',
      '添加叠加轨',
      '添加音频轨',
    ]) {
      expect(container.querySelector(`button[aria-label="${label}"]`)).not.toBeNull()
    }

    expect(container.querySelectorAll('.vwb-mt-track-head')).toHaveLength(2)
    expect(container.textContent).toContain('主视频')
    expect(container.textContent).toContain('旁白')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="静音"]')?.click()
    })
    expect(onCommand).toHaveBeenCalledWith({
      type: 'track/update',
      trackId: 'track:audio',
      changes: { muted: true },
    })

    const addAudioTrack = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('音频轨'),
    )
    await act(async () => addAudioTrack?.click())
    expect(onCommand).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'track/add' }))

    const reorderHandle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="拖拽排序：主视频"]',
    )
    await act(async () => {
      reorderHandle?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
    })
    expect(onCommand).toHaveBeenLastCalledWith({
      type: 'track/reorder',
      trackId: 'track:main',
      targetOrder: 1,
    })

    const trackName = container.querySelector<HTMLButtonElement>('.vwb-mt-track-name')
    await act(async () => {
      trackName?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="重命名轨道"]')
    await act(async () => {
      if (!renameInput) return
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(renameInput, '主画面')
      renameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      renameInput?.blur()
    })
    expect(onCommand).toHaveBeenLastCalledWith({
      type: 'track/update',
      trackId: 'track:main',
      changes: { name: '主画面' },
    })
  })

  it('selects and previews a video immediately after it is dropped onto a track', async () => {
    const project = createDefaultVideoWorkbenchProject()
    const resource = {
      id: 'video:drop',
      source: 'local' as const,
      kind: 'video' as const,
      title: 'Dropped video',
      url: 'safe-file:///drop.mp4',
      originPath: '/drop.mp4',
      importedAt: 1,
      durationSec: 6,
    }
    project.resources = [resource]
    const onCommand = vi.fn((command) => ({ applied: true as const, project, command }))
    const onSelectionChange = vi.fn()
    const onPreviewResource = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted = { root, container }

    await act(async () => {
      root.render(
        <VideoWorkbenchMultiTrackTimeline
          project={project}
          busy={false}
          readOnly={false}
          selectedClipIds={[]}
          playheadSec={0}
          playing={false}
          canUndo={false}
          canRedo={false}
          onSelectionChange={onSelectionChange}
          onPreviewResource={onPreviewResource}
          onSeek={vi.fn()}
          onPlaybackToggle={vi.fn()}
          onCommand={onCommand}
          onUpdateProject={vi.fn()}
          onUndo={vi.fn()}
          onRedo={vi.fn()}
          onOpenFrames={vi.fn()}
          onOpenEdit={vi.fn()}
          onOpenOutput={vi.fn()}
        />,
      )
    })

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperties(dropEvent, {
      clientX: { value: 8 },
      dataTransfer: {
        value: {
          getData: (type: string) =>
            type === 'application/x-vwb-resource'
              ? JSON.stringify({ resourceId: resource.id })
              : '',
          types: ['application/x-vwb-resource'],
        },
      },
    })

    await act(async () => {
      container.querySelector<HTMLElement>('.vwb-mt-lane')?.dispatchEvent(dropEvent)
    })

    const addCommand = onCommand.mock.calls.at(-1)?.[0] as {
      type?: string
      clip?: { id?: string; durationSec?: number }
    }
    expect(addCommand.type).toBe('clip/add')
    expect(addCommand.clip?.durationSec).toBe(6)
    expect(onSelectionChange).toHaveBeenLastCalledWith([addCommand.clip?.id])
    expect(onPreviewResource).toHaveBeenLastCalledWith(resource)
  })

  it('supports modifier multi-selection and dispatches atomic bulk operations', async () => {
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
        durationSec: 8,
      },
      {
        id: 'audio:1',
        source: 'local',
        kind: 'audio',
        title: 'Audio',
        url: 'safe-file:///audio.wav',
        originPath: '/audio.wav',
        importedAt: 2,
        durationSec: 14,
      },
    ]
    const visualTrack = project.tracks[0]
    if (!visualTrack) throw new Error('默认工程应包含一条画面轨')
    visualTrack.clips = [
      {
        id: 'clip:1',
        resourceId: 'video:1',
        timelineStartSec: 0,
        sourceInSec: 0,
        sourceOutSec: 4,
        durationSec: 4,
        speed: 1,
        enabled: true,
      },
      {
        id: 'clip:2',
        resourceId: 'video:1',
        timelineStartSec: 4,
        sourceInSec: 4,
        sourceOutSec: 8,
        durationSec: 4,
        speed: 1,
        enabled: true,
      },
    ]
    const audioTrack = createDefaultVideoWorkbenchTrack('audio', 'track:audio', '旁白', 1)
    audioTrack.clips = [
      {
        id: 'clip:audio',
        resourceId: 'audio:1',
        timelineStartSec: 0,
        sourceInSec: 0,
        sourceOutSec: 4,
        durationSec: 4,
        speed: 1,
        enabled: true,
        audio: { gainDb: 0, muted: false, balance: 0, preservePitch: true },
      },
      {
        id: 'clip:audio-tail',
        resourceId: 'audio:1',
        timelineStartSec: 10,
        sourceInSec: 10,
        sourceOutSec: 14,
        durationSec: 4,
        speed: 1,
        enabled: true,
        audio: { gainDb: 0, muted: false, balance: 0, preservePitch: true },
      },
    ]
    project.tracks.push(audioTrack)
    const onCommand = vi.fn((command) => ({ applied: true as const, project, command }))
    const onSelectionChange = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted = { root, container }

    const renderTimeline = async (selectedClipIds: string[]) => {
      await act(async () => {
        root.render(
          <VideoWorkbenchMultiTrackTimeline
            project={project}
            busy={false}
            readOnly={false}
            selectedClipIds={selectedClipIds}
            playheadSec={0}
            playing={false}
            canUndo={false}
            canRedo={false}
            onSelectionChange={onSelectionChange}
            onPreviewResource={vi.fn()}
            onSeek={vi.fn()}
            onPlaybackToggle={vi.fn()}
            onCommand={onCommand}
            onUpdateProject={vi.fn()}
            onUndo={vi.fn()}
            onRedo={vi.fn()}
            onOpenFrames={vi.fn()}
            onOpenEdit={vi.fn()}
            onOpenOutput={vi.fn()}
          />,
        )
      })
    }

    await renderTimeline(['clip:1'])
    await act(async () => {
      container
        .querySelector<HTMLElement>('[data-clip-id="clip:audio"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    })
    expect(onSelectionChange).toHaveBeenLastCalledWith(['clip:1', 'clip:audio'])

    await renderTimeline(['clip:1', 'clip:audio'])
    const duplicateSelected = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.includes('复制所选'))
    await act(async () => duplicateSelected?.click())
    const duplicateCommand = onCommand.mock.calls.at(-1)?.[0] as {
      type?: string
      items?: Array<{ timelineStartSec: number }>
    }
    expect(duplicateCommand.type).toBe('clip/duplicate-many')
    expect(duplicateCommand.items?.map((item) => item.timelineStartSec)).toEqual([14, 14])

    const focusedClip = container.querySelector<HTMLElement>('[data-clip-id="clip:1"]')
    focusedClip?.focus()
    await act(async () => {
      focusedClip?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    })
    expect(document.activeElement).toBe(focusedClip)
    expect(onCommand).toHaveBeenLastCalledWith({
      type: 'clip/remove-many',
      clipIds: ['clip:1', 'clip:audio'],
    })

    const removeSelected = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('删除所选'),
    )
    await act(async () => removeSelected?.click())
    expect(onCommand).toHaveBeenLastCalledWith({
      type: 'clip/remove-many',
      clipIds: ['clip:1', 'clip:audio'],
    })
    expect(onSelectionChange).toHaveBeenLastCalledWith([])
  })
})
