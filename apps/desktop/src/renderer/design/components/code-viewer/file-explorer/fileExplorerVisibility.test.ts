import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getCodeExplorerVisible,
  getCodeExplorerWidth,
  resetCodeExplorerSettingsForTest,
  setCodeExplorerWidth,
} from './fileExplorerVisibility'

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

describe('文件树默认宽度', () => {
  it('未写入过偏好时用收窄后的默认宽度 200', () => {
    stubLocalStorage(new Map())
    resetCodeExplorerSettingsForTest()
    expect(getCodeExplorerWidth()).toBe(200)
  })

  it('把旧的偏宽缓存收敛为收窄后的默认宽度', () => {
    stubLocalStorage(new Map([['spark-agent:code-explorer-width', '460']]))
    resetCodeExplorerSettingsForTest()
    expect(getCodeExplorerWidth()).toBe(200)
  })

  it('用户自己调窄过的偏好不会被迁移拉宽', () => {
    stubLocalStorage(new Map([['spark-agent:code-explorer-width', '170']]))
    resetCodeExplorerSettingsForTest()
    expect(getCodeExplorerWidth()).toBe(170)
  })

  it('迁移之后尊重用户手动拖拽的宽度（并 clamp 到新上限 400）', () => {
    const store = new Map<string, string>()
    stubLocalStorage(store)
    resetCodeExplorerSettingsForTest()
    setCodeExplorerWidth(320)
    resetCodeExplorerSettingsForTest()
    expect(getCodeExplorerWidth()).toBe(320)

    setCodeExplorerWidth(9_999)
    expect(getCodeExplorerWidth()).toBe(400)
  })
})
