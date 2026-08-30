/**
 * 极简 pathname 路由工具 —— 不引入 react-router。
 * 与 App.tsx 的手写路由协作：调用 navigate(to) 后派发 'app:navigate'，
 * 由 App.tsx 同步 path 状态。
 */
export const APP_NAVIGATE_EVENT = 'app:navigate'

export function navigate(to: string) {
  window.history.pushState({}, '', to)
  window.dispatchEvent(new Event(APP_NAVIGATE_EVENT))
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
}

export function useNavigate() {
  return navigate
}

/** 读取当前 URL 中的 query 参数 */
export function readSearchParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

export function useSearchParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}
