// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@spark/protocol'

import { useFileExplorerTree, type UseFileExplorerTreeResult } from './useFileExplorerTree'

vi.mock('../../../hooks/useIpc', () => ({
  useIpcStream: vi.fn(),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness({
  expandedDirs = new Set(),
  sessionId = null,
  onState,
}: {
  expandedDirs?: Set<string>
  sessionId?: SessionId | null
  onState: (state: UseFileExplorerTreeResult) => void
}): React.ReactElement {
  const state = useFileExplorerTree({
    workspaceId: 'workspace-1',
    sessionId,
    enabled: true,
    expandedDirs,
    onExpandedChange: vi.fn(),
  })
  onState(state)
  return <span>{state.loading ? 'loading' : 'ready'}</span>
}

describe('useFileExplorerTree', () => {
  let container: HTMLDivElement
  let root: Root | null
  const invoke = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    invoke.mockReset()
    invoke.mockImplementation((channel: string, request: { path?: string }) => {
      if (channel !== 'workspace:list-directory') return Promise.resolve({})
      if (request.path === 'node_modules') {
        return Promise.resolve({
          entries: [
            {
              name: 'package-a',
              path: 'node_modules/package-a',
              type: 'directory',
              depth: 0,
              childrenCount: 1,
            },
          ],
        })
      }
      return Promise.resolve({
        entries: [
          {
            name: 'node_modules',
            path: 'node_modules',
            type: 'directory',
            depth: 0,
            childrenCount: 1,
          },
          { name: 'package.json', path: 'package.json', type: 'file', depth: 0, extension: 'json' },
        ],
      })
    })
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

  it('loads only direct children and explicitly includes ordinary excluded directories', async () => {
    const state: { current?: UseFileExplorerTreeResult } = {}
    await act(async () => {
      root?.render(<Harness onState={(value) => (state.current = value)} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(invoke).toHaveBeenCalledWith('workspace:list-directory', {
      workspaceId: 'workspace-1',
      maxDepth: 0,
      includeIgnoredDirectories: true,
    })

    await act(async () => {
      state.current?.toggleDir('node_modules')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(invoke).toHaveBeenCalledWith('workspace:list-directory', {
      workspaceId: 'workspace-1',
      path: 'node_modules',
      maxDepth: 0,
      includeIgnoredDirectories: true,
    })
  })

  it('restores direct children for directories remembered as expanded', async () => {
    const state: { current?: UseFileExplorerTreeResult } = {}
    await act(async () => {
      root?.render(
        <Harness
          expandedDirs={new Set(['node_modules'])}
          onState={(value) => (state.current = value)}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(invoke).toHaveBeenCalledWith('workspace:list-directory', {
      workspaceId: 'workspace-1',
      path: 'node_modules',
      maxDepth: 0,
      includeIgnoredDirectories: true,
    })
    expect(state.current?.nodes.has('node_modules/package-a')).toBe(true)
    expect(state.current?.visiblePaths).toContain('node_modules/package-a')
  })

  it('scopes list and watch requests to the active session', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000001' as SessionId
    await act(async () => {
      root?.render(<Harness sessionId={sessionId} onState={() => {}} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(invoke).toHaveBeenCalledWith(
      'workspace:list-directory',
      expect.objectContaining({ workspaceId: 'workspace-1', sessionId }),
    )
    expect(invoke).toHaveBeenCalledWith('workspace:watch-start', {
      workspaceId: 'workspace-1',
      sessionId,
    })
  })
})
