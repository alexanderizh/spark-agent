/**
 * useRefreshable — 把当前视图注册为「应用内刷新」的目标
 *
 * 背景：
 *   Ctrl/Cmd+R 是浏览器/ Electron 的默认硬刷新键。在 SPA 中触发会把整页 reload，
 *   React 状态全部丢失，AppContext 回到默认 view = 'chat'，于是用户在其他面板里
 *   按下 Ctrl+R 会「跳回会话界面」。
 *
 * 解决方案：
 *   1. useKeyboard 在 keydown 阶段拦截 Ctrl/Cmd+R，preventDefault 后抛出
 *      `spark:refresh-view` CustomEvent。
 *   2. 每个可刷新的视图调用 useRefreshable(refresh)，把当前的 refresh 函数
 *      注册进 window 事件订阅里（同时只会有一个 mounted 视图在订阅，所以事件
 *      只会触发当前显示的那个）。
 *   3. 视图自己负责「刷新」的具体语义——重新拉列表、重新计算过滤等。
 *
 * shift+ctrl/cmd+R 不被拦截，仍然是 Electron 自己的硬刷新，保留这条「真正 reload
 * 应用」的逃生口。
 */
import { useCallback, useEffect, useRef } from 'react'

export const REFRESH_EVENT = 'spark:refresh-view'

/** 触发一次应用内刷新（任何代码都可调用，模拟 Ctrl+R 行为）。 */
export function triggerRefresh(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT))
}

/**
 * 在当前组件挂载期间订阅 spark:refresh-view 事件，收到事件时调用 refresh。
 * 返回一个手动触发器，可以挂在「刷新」按钮的 onClick 上。
 *
 * 注意：因为视图是条件渲染的（App.tsx 的 switch(view)），同一时刻最多只有一个
 * 视图处于 mounted 状态，所以不需要在事件里附带 viewId；事件触发时只有
 * 当前 view 的 useRefreshable 在监听。
 */
export function useRefreshable(
  refresh: () => void | Promise<void>,
  options: { enabled?: boolean } = {},
): () => void {
  const refreshRef = useRef(refresh)
  const enabledRef = useRef(options.enabled ?? true)
  refreshRef.current = refresh
  enabledRef.current = options.enabled ?? true

  useEffect(() => {
    if (options.enabled === false) return
    const handler = () => {
      if (!enabledRef.current) return
      void Promise.resolve(refreshRef.current()).catch((err) => {
        // 刷新失败时仅在控制台记录，不打断用户。
        // 各视图内部已经会在加载失败时显示 toast/empty state。
        console.warn('[useRefreshable] refresh failed:', err)
      })
    }
    window.addEventListener(REFRESH_EVENT, handler)
    return () => window.removeEventListener(REFRESH_EVENT, handler)
  }, [options.enabled])

  return useCallback(() => {
    if (options.enabled === false) return
    void Promise.resolve(refreshRef.current()).catch((err) => {
      console.warn('[useRefreshable] refresh failed:', err)
    })
  }, [options.enabled])
}
