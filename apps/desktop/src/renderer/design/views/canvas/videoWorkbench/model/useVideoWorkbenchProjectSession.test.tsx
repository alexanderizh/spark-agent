// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDefaultVideoWorkbenchProject,
  createDefaultVideoWorkbenchTrack,
} from './projectTypes'
import { useVideoWorkbenchProjectSession } from './useVideoWorkbenchProjectSession'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness({ raw, onSave }: { raw: unknown; onSave: (project: unknown) => Promise<void> }) {
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

describe('useVideoWorkbenchProjectSession', () => {
  it('records commands in bounded history and persists the V2 project', async () => {
    vi.useFakeTimers()
    const onSave = vi.fn(async () => undefined)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted = { root, container }
    await act(async () =>
      root.render(<Harness raw={createDefaultVideoWorkbenchProject()} onSave={onSave} />),
    )

    const buttons = container.querySelectorAll<HTMLButtonElement>('button')
    await act(async () => buttons[0]?.click())
    expect(container.querySelector('[data-testid="track-count"]')?.textContent).toBe('2')
    await act(async () => vi.runAllTimersAsync())
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: 2 }))

    await act(async () => buttons[1]?.click())
    expect(container.querySelector('[data-testid="track-count"]')?.textContent).toBe('1')
    await act(async () => {
      buttons[3]?.click()
      buttons[2]?.click()
    })
    expect(container.querySelector('[data-testid="track-count"]')?.textContent).toBe('1')
    expect(container.querySelector('[data-testid="width"]')?.textContent).toBe('720')
  })

  it('blocks all project mutations and persistence for unsupported future versions', async () => {
    vi.useFakeTimers()
    const onSave = vi.fn(async () => undefined)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted = { root, container }
    await act(async () => root.render(<Harness raw={{ schemaVersion: 99 }} onSave={onSave} />))

    expect(container.querySelector('[data-testid="readonly"]')?.textContent).toBe('true')
    const buttons = container.querySelectorAll<HTMLButtonElement>('button')
    await act(async () => {
      buttons[0]?.click()
      buttons[3]?.click()
      await vi.runAllTimersAsync()
    })
    expect(container.querySelector('[data-testid="track-count"]')?.textContent).toBe('1')
    expect(container.querySelector('[data-testid="width"]')?.textContent).toBe('1920')
    expect(onSave).not.toHaveBeenCalled()
  })
})
