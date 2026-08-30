// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  Switch: ({ checked, disabled }: { checked: boolean; disabled?: boolean }) => (
    <input type="checkbox" checked={checked} disabled={disabled} readOnly />
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('../../../Icons', () => ({
  Icons: new Proxy({}, { get: () => () => <span /> }),
}))

vi.mock('./VideoWorkbenchResourceThumb', () => ({
  ResourceThumb: () => <span />,
}))

import { VideoWorkbenchResourcePanel } from './VideoWorkbenchResourcePanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let mounted: { root: ReturnType<typeof createRoot>; container: HTMLElement } | null = null

afterEach(async () => {
  if (!mounted) return
  await act(async () => mounted?.root.unmount())
  mounted.container.remove()
  mounted = null
})

describe('VideoWorkbenchResourcePanel', () => {
  it('allows a resource already used by one clip to be inserted again', async () => {
    const resource = {
      id: 'video:1',
      source: 'local' as const,
      kind: 'video' as const,
      title: 'Video',
      url: 'safe-file:///video.mp4',
      originPath: '/video.mp4',
      importedAt: 1,
    }
    const onAddToTrack = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted = { root, container }

    await act(async () => {
      root.render(
        <VideoWorkbenchResourcePanel
          resources={[resource]}
          track={[{ id: 'clip:1', resourceId: resource.id, order: 0 }]}
          usedResourceIds={new Set([resource.id])}
          autoCollectUpstream={false}
          busy={false}
          onAddToTrack={onAddToTrack}
          onPreview={vi.fn()}
          onRemoveResource={vi.fn()}
          onAutoCollectToggle={vi.fn()}
          onCollectUpstream={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain('已在轨道')
    const addAgain = container.querySelector<HTMLButtonElement>(
      'button[aria-label="加入 Video 到轨道"]',
    )
    expect(addAgain).not.toBeNull()
    await act(async () => addAgain?.click())
    expect(onAddToTrack).toHaveBeenCalledWith(resource)
  })
})
