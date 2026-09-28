// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  getCodeExplorerVisible,
  resetCodeExplorerSettingsForTest,
  setCodeExplorerVisible,
} from '../file-explorer/fileExplorerVisibility'
import {
  getGitPanelVisible,
  getGitPanelWidth,
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

  it('defaults existing users to content search after the mode schema upgrade', () => {
    expect(getSearchPanelMode()).toBe('content')
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
    expect(getSearchPanelWidth()).toBe(560)
    expect(localStorage.getItem('spark-agent:code-search-panel-width')).toBe('560')
  })

  it('把旧版偏宽的缓存收敛为收窄后的默认宽度', () => {
    localStorage.clear()
    localStorage.setItem('spark-agent:code-search-panel-width', '640')
    resetSearchPanelSettingsForTest()
    expect(getSearchPanelWidth()).toBe(300)
  })

  it('用户自己调窄过的偏好不会被迁移拉宽', () => {
    localStorage.clear()
    localStorage.setItem('spark-agent:code-search-panel-width', '240')
    resetSearchPanelSettingsForTest()
    expect(getSearchPanelWidth()).toBe(240)
  })

  it('迁移之后尊重用户手动拖拽的宽度', () => {
    setSearchPanelWidth(420)
    resetSearchPanelSettingsForTest()
    expect(getSearchPanelWidth()).toBe(420)
  })

  it('Git 面板同样迁移：旧上限 520 收敛到新默认 260，调窄过的保留', () => {
    localStorage.clear()
    localStorage.setItem('spark-agent:code-git-panel-width', '520')
    resetGitPanelSettingsForTest()
    expect(getGitPanelWidth()).toBe(260)

    localStorage.clear()
    localStorage.setItem('spark-agent:code-git-panel-width', '200')
    resetGitPanelSettingsForTest()
    expect(getGitPanelWidth()).toBe(200)
  })
})
