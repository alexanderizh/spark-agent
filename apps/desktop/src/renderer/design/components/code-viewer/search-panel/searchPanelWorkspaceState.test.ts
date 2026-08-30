// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  readSearchPanelWorkspaceState,
  writeSearchPanelWorkspaceState,
} from './searchPanelWorkspaceState'

describe('searchPanelWorkspaceState', () => {
  beforeEach(() => localStorage.clear())

  it('keeps independent file/content queries and layout per workspace', () => {
    writeSearchPanelWorkspaceState('workspace-a', {
      queries: { files: 'panel.tsx', content: 'border-radius' },
      caseSensitive: true,
      resultLayout: 'list',
    })

    expect(readSearchPanelWorkspaceState('workspace-a')).toEqual({
      queries: { files: 'panel.tsx', content: 'border-radius' },
      caseSensitive: true,
      resultLayout: 'list',
    })
    expect(readSearchPanelWorkspaceState('workspace-b').queries.content).toBe('')
  })
})
