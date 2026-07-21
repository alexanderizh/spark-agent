// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  filterVideoWorkbenchPickerCandidates,
  type VideoWorkbenchPickerCandidate,
} from './videoWorkbenchResourcePickerModel'

vi.mock('antd', () => ({
  Button: ({
    children,
    loading: _loading,
    ...props
  }: { children: ReactNode; loading?: boolean } & Record<string, unknown>) => (
    <button {...props}>{children}</button>
  ),
  Modal: ({
    open,
    title,
    children,
    footer,
  }: {
    open: boolean
    title: ReactNode
    children: ReactNode
    footer: ReactNode
  }) =>
    open ? (
      <section>
        <h1>{title}</h1>
        {children}
        <footer>{footer}</footer>
      </section>
    ) : null,
}))

vi.mock('../../../Icons', () => ({
  Icons: {
    Check: () => <span>checked</span>,
    Layers: () => <span>layers</span>,
  },
}))

vi.mock('./VideoWorkbenchResourceThumb', () => ({
  ResourceThumb: ({ resource }: { resource: { url: string } }) => (
    <span data-testid="resource-thumb">{resource.url}</span>
  ),
}))

import { VideoWorkbenchResourcePicker } from './VideoWorkbenchResourcePicker'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const candidates: VideoWorkbenchPickerCandidate[] = [
  {
    id: 'image-with-video-title',
    title: '视频风格参考图',
    kind: 'image',
    url: 'safe-file:///project/reference.png',
  },
  {
    id: 'video-with-image-title',
    title: '图片转场成片',
    kind: 'video',
    url: 'safe-file:///project/final-video.mp4',
  },
  {
    id: 'encoded-file-name',
    title: '镜头 03',
    kind: 'image',
    url: 'safe-file:///project/%E9%9B%A8%E5%A4%9C%E8%BD%A6%E7%AB%99.png',
  },
]

let mounted: { root: ReturnType<typeof createRoot>; container: HTMLElement } | null = null

afterEach(async () => {
  if (!mounted) return
  await act(async () => mounted?.root.unmount())
  mounted.container.remove()
  mounted = null
})

describe('VideoWorkbenchResourcePicker filtering', () => {
  it('filters by the resource kind instead of words in the title', () => {
    expect(
      filterVideoWorkbenchPickerCandidates(candidates, 'video', '').map((item) => item.id),
    ).toEqual(['video-with-image-title'])
    expect(
      filterVideoWorkbenchPickerCandidates(candidates, 'image', '').map((item) => item.id),
    ).toEqual(['image-with-video-title', 'encoded-file-name'])
  })

  it('matches normalized titles and decoded file names', () => {
    expect(
      filterVideoWorkbenchPickerCandidates(candidates, 'all', 'ＦＩＮＡＬ').map((item) => item.id),
    ).toEqual(['video-with-image-title'])
    expect(
      filterVideoWorkbenchPickerCandidates(candidates, 'all', '雨夜车站').map((item) => item.id),
    ).toEqual(['encoded-file-name'])
  })

  it('combines the active media filter with the search query', () => {
    expect(
      filterVideoWorkbenchPickerCandidates(candidates, 'image', '视频').map((item) => item.id),
    ).toEqual(['image-with-video-title'])
    expect(filterVideoWorkbenchPickerCandidates(candidates, 'video', '车站')).toEqual([])
  })
})

describe('VideoWorkbenchResourcePicker selection', () => {
  it('renders one vertical result list and confirms multiple selected resources', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted = { root, container }
    const onConfirm = vi.fn()

    await act(async () => {
      root.render(
        <VideoWorkbenchResourcePicker
          open
          candidates={candidates}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />,
      )
    })

    expect(container.querySelectorAll('.vwb-picker-results')).toHaveLength(1)
    const rows = container.querySelectorAll<HTMLButtonElement>('.vwb-picker-result')
    expect(rows).toHaveLength(3)

    await act(async () => {
      rows[0]?.click()
      rows[2]?.click()
    })
    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>('footer button')).find(
      (button) => button.textContent?.includes('加入资源面板'),
    )
    await act(async () => confirm?.click())

    expect(onConfirm).toHaveBeenCalledWith([candidates[0], candidates[2]])
  })

  it('keeps the video filter tied to kind metadata in the rendered list', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted = { root, container }

    await act(async () => {
      root.render(
        <VideoWorkbenchResourcePicker
          open
          candidates={candidates}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      )
    })
    const videoFilter = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.vwb-picker-chip'),
    ).find((button) => button.textContent?.includes('视频'))
    await act(async () => videoFilter?.click())

    const visibleRows = container.querySelectorAll<HTMLButtonElement>('.vwb-picker-result')
    expect(visibleRows).toHaveLength(1)
    expect(visibleRows[0]?.textContent).toContain('图片转场成片')
  })
})
