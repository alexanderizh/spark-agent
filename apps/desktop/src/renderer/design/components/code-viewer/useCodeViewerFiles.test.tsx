// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeFile } from './types'
import {
  CODE_VIEWER_MAX_FILE_BYTES,
  useCodeViewerFiles,
  type UseCodeViewerFilesResult,
} from './useCodeViewerFiles'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const first: OpenCodeFile = {
  absPath: '/repo/first.ts',
  displayPath: 'first.ts',
  fileType: 'text',
}
const second: OpenCodeFile = {
  absPath: '/repo/second.ts',
  displayPath: 'second.ts',
  fileType: 'text',
}

function Harness({
  files,
  active,
  onState,
}: {
  files: OpenCodeFile[]
  active: string | null
  onState: (state: UseCodeViewerFilesResult) => void
}): React.ReactElement {
  const state = useCodeViewerFiles(files, active)
  onState(state)
  return <span>{state.activeRuntime?.state ?? 'idle'}</span>
}

describe('useCodeViewerFiles', () => {
  let container: HTMLDivElement
  let root: Root | null
  const invoke = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    invoke.mockReset()
    invoke.mockImplementation((_channel: string, request: { filePath: string }) =>
      Promise.resolve({ content: `content:${request.filePath}`, encoding: 'utf-8' }),
    )
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke },
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('reads only the active tab with main-process size and binary guards', async () => {
    const state: { current?: UseCodeViewerFilesResult } = {}
    await act(async () => {
      root?.render(
        <Harness
          files={[first, second]}
          active={first.absPath}
          onState={(v) => (state.current = v)}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('file:read', {
      filePath: first.absPath,
      maxBytes: CODE_VIEWER_MAX_FILE_BYTES,
      rejectBinary: true,
    })
    expect(state.current?.runtimes[second.absPath]).toBeUndefined()
  })

  it('evicts inactive saved content and reloads it only when reactivated', async () => {
    const state: { current?: UseCodeViewerFilesResult } = {}
    const render = (files: OpenCodeFile[], active: string | null): void => {
      root?.render(<Harness files={files} active={active} onState={(v) => (state.current = v)} />)
    }

    await act(async () => {
      render([first, second], first.absPath)
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      render([first, second], second.absPath)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(invoke).toHaveBeenCalledTimes(2)
    expect(state.current?.runtimes[first.absPath]).toBeUndefined()
    expect(state.current?.runtimes[second.absPath]?.state).toBe('ready')

    await act(async () => {
      render([first, second], first.absPath)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('keeps unsaved content in memory when another tab becomes active', async () => {
    const state: { current?: UseCodeViewerFilesResult } = {}
    const render = (active: string): void => {
      root?.render(
        <Harness files={[first, second]} active={active} onState={(v) => (state.current = v)} />,
      )
    }

    await act(async () => {
      render(first.absPath)
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => state.current?.editActive('unsaved change'))
    await act(async () => {
      render(second.absPath)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(state.current?.runtimes[first.absPath]?.content).toBe('unsaved change')
    expect(state.current?.isDirty(first.absPath)).toBe(true)
  })

  it('ignores an older read after the same path is closed and reopened', async () => {
    const state: { current?: UseCodeViewerFilesResult } = {}
    let resolveOldRead: ((value: { content: string; encoding: string }) => void) | undefined
    invoke
      .mockImplementationOnce(
        () =>
          new Promise<{ content: string; encoding: string }>((resolve) => {
            resolveOldRead = resolve
          }),
      )
      .mockResolvedValueOnce({ content: 'new content', encoding: 'utf-8' })

    const render = (files: OpenCodeFile[], active: string | null): void => {
      root?.render(<Harness files={files} active={active} onState={(v) => (state.current = v)} />)
    }

    await act(async () => render([first], first.absPath))
    await act(async () => render([], null))
    await act(async () => {
      render([first], first.absPath)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(state.current?.activeRuntime?.content).toBe('new content')

    await act(async () => {
      resolveOldRead?.({ content: 'stale content', encoding: 'utf-8' })
      await Promise.resolve()
    })
    expect(state.current?.activeRuntime?.content).toBe('new content')
  })

  it('removes runtime content when its tab is closed', async () => {
    const state: { current?: UseCodeViewerFilesResult } = {}
    await act(async () => {
      root?.render(
        <Harness files={[first]} active={first.absPath} onState={(v) => (state.current = v)} />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      root?.render(<Harness files={[]} active={null} onState={(v) => (state.current = v)} />)
    })

    expect(state.current?.runtimes[first.absPath]).toBeUndefined()
  })
})
