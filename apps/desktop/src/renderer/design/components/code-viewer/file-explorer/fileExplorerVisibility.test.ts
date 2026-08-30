import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCodeExplorerVisible, resetCodeExplorerSettingsForTest } from './fileExplorerVisibility'

// node 环境 stub window.localStorage；resetForTest 触发 readSettings() 重新读取

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubLocalStorage(store: Map<string, string>): void {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  })
}

describe('文件树默认可见性', () => {
  it('未写入过偏好时默认展开', () => {
    stubLocalStorage(new Map())
    resetCodeExplorerSettingsForTest()
    expect(getCodeExplorerVisible()).toBe(true)
  })

  it('用户显式收起过后保持收起（记住偏好）', () => {
    stubLocalStorage(new Map([['spark-agent:code-explorer-visible', 'false']]))
    resetCodeExplorerSettingsForTest()
    expect(getCodeExplorerVisible()).toBe(false)
  })

  it('用户显式展开过则保持展开', () => {
    stubLocalStorage(new Map([['spark-agent:code-explorer-visible', 'true']]))
    resetCodeExplorerSettingsForTest()
    expect(getCodeExplorerVisible()).toBe(true)
  })
})
