// @vitest-environment jsdom

import { type ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClickableFilePath } from './ClickableFilePath'

vi.mock('@lobehub/ui', () => ({
  Dropdown: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./Toast', () => ({
  useToast: () => ({
    toast: {
      error: vi.fn(),
      success: vi.fn(),
    },
  }),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ClickableFilePath', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let invoke: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'file:stat-kind') return { kind: 'file' }
      if (channel === 'file:open') return { opened: true }
      return {}
    })
    vi.stubGlobal('spark', { invoke, on: vi.fn(() => vi.fn()) })
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    vi.unstubAllGlobals()
  })

  it('resolves a relative path against the workspace before opening it', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ClickableFilePath
          path="src/event-mapper.ts"
          workspaceRootPath={'G:\\spark\\spark-agent'}
        />,
      )
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('file:stat-kind', {
        path: 'G:\\spark\\spark-agent\\src\\event-mapper.ts',
      })
    })

    const link = container.querySelector('.clickable-file-path')
    expect(link).not.toBeNull()
    await act(async () => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(invoke).toHaveBeenCalledWith('file:open', {
      filePath: 'G:\\spark\\spark-agent\\src\\event-mapper.ts',
    })
  })

  it('renders a missing file path as plain text', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'file:stat-kind') return { kind: 'absent' }
      return {}
    })

    await act(async () => {
      root = createRoot(container)
      root.render(<ClickableFilePath path={'G:\\spark\\spark-agent\\missing.ts'} />)
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('file:stat-kind', {
        path: 'G:\\spark\\spark-agent\\missing.ts',
      })
    })
    expect(container.querySelector('.clickable-file-path')).toBeNull()
    expect(container.textContent).toContain('G:\\spark\\spark-agent\\missing.ts')
  })

  it('renders a relative path as plain text without workspace context', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<ClickableFilePath path="event-mapper.ts" />)
      await Promise.resolve()
    })

    expect(container.querySelector('.clickable-file-path')).toBeNull()
    expect(container.textContent).toContain('event-mapper.ts')
    expect(invoke).not.toHaveBeenCalledWith('file:stat-kind', expect.anything())
  })
})
