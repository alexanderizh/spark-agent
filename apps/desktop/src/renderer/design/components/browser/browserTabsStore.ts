/**
 * browserTabsStore — 内置浏览器 tab 状态（模块级单例）。
 *
 * 放在模块级而非组件 state 的原因：浏览器面板 tab 在统一侧边面板中切换 /
 * 收起时会卸载 BrowserChrome，所有 <webview> 随之销毁；但 tab 列表本身留在
 * store 里，面板再次展开时按记录的 URL 重建 webview，浏览现场不丢。
 *
 * 独立窗口（BrowserWindowApp）是另一个 renderer 进程，持有自己的 store 实例，
 * 切换窗口模式时只传递当前页 URL。
 */
import { useSyncExternalStore } from 'react'
import { BLANK_TAB_URL, DEFAULT_BROWSER_URL, MAX_BROWSER_TABS } from './browserChromeShared'

export interface BrowserTabItem {
  id: string
  url: string
  title: string | null
  favicon: string | null
  /** webview 是否完成过首次挂载（用于 React key 稳定 + src 只设一次） */
  createdAt: number
}

export interface BrowserTabsState {
  tabs: BrowserTabItem[]
  activeId: string | null
}

export type BrowserTabsAction =
  | { type: 'add'; url?: string; activate?: boolean }
  | { type: 'close'; id: string }
  | { type: 'select'; id: string }
  | { type: 'navigate'; id: string; url: string }
  | { type: 'meta'; id: string; url?: string | null; title?: string | null; favicon?: string | null }
  | { type: 'reset'; initialUrl?: string }

let tabSeq = 0

export function createBrowserTab(url: string = BLANK_TAB_URL): BrowserTabItem {
  tabSeq += 1
  return {
    id: `tab-${Date.now().toString(36)}-${tabSeq}`,
    url,
    title: null,
    favicon: null,
    createdAt: Date.now(),
  }
}

/** 纯 reducer：所有状态转移集中在这里，便于单测。 */
export function browserTabsReducer(
  state: BrowserTabsState,
  action: BrowserTabsAction,
): BrowserTabsState {
  switch (action.type) {
    case 'add': {
      if (state.tabs.length >= MAX_BROWSER_TABS) return state
      const tab = createBrowserTab(action.url)
      return {
        tabs: [...state.tabs, tab],
        activeId: action.activate === false ? state.activeId : tab.id,
      }
    }
    case 'close': {
      const index = state.tabs.findIndex((tab) => tab.id === action.id)
      if (index < 0) return state
      const tabs = state.tabs.filter((tab) => tab.id !== action.id)
      // 关掉最后一个 tab 时保留一个空白 tab，浏览器壳不塌陷
      if (tabs.length === 0) {
        const fresh = createBrowserTab()
        return { tabs: [fresh], activeId: fresh.id }
      }
      const fallback = tabs[Math.min(index, tabs.length - 1)]
      const activeId = state.activeId === action.id ? fallback?.id ?? tabs[0]!.id : state.activeId
      return { tabs, activeId }
    }
    case 'select': {
      if (!state.tabs.some((tab) => tab.id === action.id)) return state
      return state.activeId === action.id ? state : { ...state, activeId: action.id }
    }
    case 'navigate': {
      return patchTab(state, action.id, (tab) => ({ ...tab, url: action.url }))
    }
    case 'meta': {
      return patchTab(state, action.id, (tab) => ({
        ...tab,
        ...(action.url != null ? { url: action.url } : {}),
        ...(action.title !== undefined ? { title: action.title } : {}),
        ...(action.favicon !== undefined ? { favicon: action.favicon } : {}),
      }))
    }
    case 'reset': {
      const tab = createBrowserTab(action.initialUrl)
      return { tabs: [tab], activeId: tab.id }
    }
  }
}

function patchTab(
  state: BrowserTabsState,
  id: string,
  patch: (tab: BrowserTabItem) => BrowserTabItem,
): BrowserTabsState {
  let changed = false
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== id) return tab
    changed = true
    return patch(tab)
  })
  return changed ? { ...state, tabs } : state
}

/** 轻量 observable store：dispatch → reduce → 通知订阅者。 */
export class BrowserTabsStore {
  private state: BrowserTabsState
  private readonly listeners = new Set<() => void>()

  constructor(initialUrl?: string) {
    const tab = createBrowserTab(initialUrl)
    this.state = { tabs: [tab], activeId: tab.id }
  }

  getState = (): BrowserTabsState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispatch = (action: BrowserTabsAction): void => {
    const next = browserTabsReducer(this.state, action)
    if (next === this.state) return
    this.state = next
    for (const listener of this.listeners) listener()
  }

  /** 面板首次展开时把仍是空白的唯一 tab 指到默认首页（不劫持已浏览的 tab）。 */
  seedBlank = (url: string): void => {
    if (this.state.tabs.length !== 1) return
    const only = this.state.tabs[0]
    if (only == null || only.url !== BLANK_TAB_URL) return
    this.dispatch({ type: 'navigate', id: only.id, url })
  }
}

/**
 * 主窗口内的面板 store（单例）。独立窗口不 import 此实例，
 * 由 BrowserWindowApp 自行 new 一个。
 *
 * 初始即带默认首页而非 about:blank：webview 的 src 在首次渲染时取 tab.url，
 * 之后向未完成 attach 的 webview 调 loadURL 会同步 throw，因此面板打开前的
 * 导航请求必须先落进 store（由 ChatView 的 OPEN handler dispatch），让首次
 * 渲染的 src 就是目标 URL。
 */
export const panelBrowserTabsStore = new BrowserTabsStore(DEFAULT_BROWSER_URL)

/** React 绑定：useSyncExternalStore 订阅 store。 */
export function useBrowserTabs(store: BrowserTabsStore): BrowserTabsState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
