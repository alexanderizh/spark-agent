// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  getCodeExplorerVisible,
  resetCodeExplorerSettingsForTest,
  setCodeExplorerVisible,
} from '../file-explorer/fileExplorerVisibility'
import {
  getGitPanelVisible,
  resetGitPanelSettingsForTest,
  toggleGitPanel,
} from '../git-panel/gitPanelVisibility'
import {
  getSearchPanelMode,
  getSearchPanelVisible,
  getSearchPanelWidth,
  openSearchPanel,
  resetSearchPanelSettingsForTest,
  setSearchPanelWidth,
} from './searchPanelVisibility'

describe('searchPanelVisibility', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCodeExplorerSettingsForTest()
    resetGitPanelSettingsForTest()
    resetSearchPanelSettingsForTest()
  })

  it('opens search in the requested mode and closes the other sidebar panels', () => {
    setCodeExplorerVisible(true)
    toggleGitPanel(true)

    openSearchPanel('content')

    expect(getSearchPanelVisible()).toBe(true)
    expect(getSearchPanelMode()).toBe('content')
    expect(getCodeExplorerVisible()).toBe(false)
    expect(getGitPanelVisible()).toBe(false)
  })

  it('clamps and persists its independent width', () => {
    setSearchPanelWidth(10_000)
    expect(getSearchPanelWidth()).toBe(640)
    expect(localStorage.getItem('spark-agent:code-search-panel-width')).toBe('640')
  })
})
