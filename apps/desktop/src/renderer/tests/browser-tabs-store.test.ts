import { describe, expect, it } from 'vitest'
import {
  BrowserTabsStore,
  browserTabsReducer,
  createBrowserTab,
  type BrowserTabsState,
} from '../design/components/browser/browserTabsStore'
import { BLANK_TAB_URL, MAX_BROWSER_TABS } from '../design/components/browser/browserChromeShared'

function initialState(urls: string[] = []): BrowserTabsState {
  const tabs = urls.map((url) => createBrowserTab(url))
  return { tabs, activeId: tabs[0]?.id ?? null }
}

describe('browserTabsReducer', () => {
  it('add 新增并激活', () => {
    const state = initialState(['https://a.com'])
    const next = browserTabsReducer(state, { type: 'add', url: 'https://b.com' })
    expect(next.tabs).toHaveLength(2)
    expect(next.activeId).toBe(next.tabs[1]!.id)
    expect(next.tabs[1]!.url).toBe('https://b.com')
  })

  it('add 达到上限后拒绝新增', () => {
    const state = initialState(
      Array.from({ length: MAX_BROWSER_TABS }, (_, i) => `https://t${i}.com`),
    )
    const next = browserTabsReducer(state, { type: 'add' })
    expect(next).toBe(state)
  })

  it('add activate=false 不抢占活动 tab', () => {
    const state = initialState(['https://a.com'])
    const next = browserTabsReducer(state, { type: 'add', url: 'https://b.com', activate: false })
    expect(next.activeId).toBe(state.activeId)
  })

  it('close 关闭非活动 tab 时活动 tab 不变', () => {
    const state = initialState(['https://a.com', 'https://b.com'])
    const next = browserTabsReducer(state, { type: 'close', id: state.tabs[1]!.id })
    expect(next.tabs).toHaveLength(1)
    expect(next.activeId).toBe(state.activeId)
  })

  it('close 关闭活动 tab 时切到相邻 tab', () => {
    const state = initialState(['https://a.com', 'https://b.com', 'https://c.com'])
    // 关闭中间的活动 tab（先激活中间）
    const activated = browserTabsReducer(state, { type: 'select', id: state.tabs[1]!.id })
    const next = browserTabsReducer(activated, { type: 'close', id: state.tabs[1]!.id })
    expect(next.activeId).toBe(state.tabs[2]!.id)
  })

  it('close 关掉最后一个 tab 自动开空白 tab', () => {
    const state = initialState(['https://a.com'])
    const next = browserTabsReducer(state, { type: 'close', id: state.tabs[0]!.id })
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0]!.url).toBe(BLANK_TAB_URL)
    expect(next.activeId).toBe(next.tabs[0]!.id)
  })

  it('select 不存在的 id 不变', () => {
    const state = initialState(['https://a.com'])
    expect(browserTabsReducer(state, { type: 'select', id: 'nope' })).toBe(state)
  })

  it('meta 只更新目标 tab 的元数据', () => {
    const state = initialState(['https://a.com', 'https://b.com'])
    const next = browserTabsReducer(state, {
      type: 'meta',
      id: state.tabs[1]!.id,
      url: 'https://b.com/x',
      title: 'B 页',
      favicon: 'https://b.com/favicon.ico',
    })
    expect(next.tabs[1]!.title).toBe('B 页')
    expect(next.tabs[1]!.favicon).toBe('https://b.com/favicon.ico')
    expect(next.tabs[1]!.url).toBe('https://b.com/x')
    expect(next.tabs[0]!.title).toBeNull()
  })
})

describe('BrowserTabsStore', () => {
  it('dispatch 触发订阅、unsubscribe 后不再触发', () => {
    const store = new BrowserTabsStore('https://a.com')
    let notified = 0
    const unsub = store.subscribe(() => {
      notified += 1
    })
    store.dispatch({ type: 'add' })
    expect(notified).toBe(1)
    unsub()
    store.dispatch({ type: 'add' })
    expect(notified).toBe(1)
  })

  it('seedBlank 只改写仍是空白的唯一 tab', () => {
    const store = new BrowserTabsStore()
    store.seedBlank('https://home.com')
    expect(store.getState().tabs[0]!.url).toBe('https://home.com')

    // 已有内容时不再劫持
    store.dispatch({ type: 'navigate', id: store.getState().tabs[0]!.id, url: 'https://x.com' })
    store.seedBlank('https://home.com')
    expect(store.getState().tabs[0]!.url).toBe('https://x.com')
  })
})
